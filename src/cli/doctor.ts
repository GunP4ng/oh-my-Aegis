import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { scoreBenchmark, parseBenchmarkManifest } from "../benchmark/scoring";
import { buildReadinessReport } from "../config/readiness";
import { loadConfig } from "../config/loader";
import { NotesStore } from "../state/notes-store";

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  ok: boolean;
  generatedAt: string;
  projectDir: string;
  checks: DoctorCheck[];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function pushList(lines: string[], label: string, items: string[], limit = 6): void {
  if (items.length === 0) {
    lines.push(`- ${label}: none`);
    return;
  }
  lines.push(`- ${label} (${items.length}):`);
  for (const item of items.slice(0, limit)) {
    lines.push(`  - ${item}`);
  }
  if (items.length > limit) {
    lines.push(`  - ... +${items.length - limit} more`);
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const pass = report.checks.filter((check) => check.status === "pass").length;
  const warn = report.checks.filter((check) => check.status === "warn").length;
  const fail = report.checks.filter((check) => check.status === "fail").length;
  const statusLabel = report.ok ? "PASS" : "FAIL";
  const lines: string[] = [
    "oh-my-Aegis doctor",
    `result: ${statusLabel} (pass=${pass}, warn=${warn}, fail=${fail})`,
    `project: ${report.projectDir}`,
    `generated: ${report.generatedAt}`,
    "",
    "checks:",
  ];

  for (const check of report.checks) {
    lines.push(`- [${check.status.toUpperCase()}] ${check.name}: ${check.message}`);
  }

  const readiness = report.checks.find((check) => check.name === "orchestrator.readiness");
  if (readiness?.details && typeof readiness.details === "object") {
    const details = readiness.details as Record<string, unknown>;
    lines.push("", "readiness details:");
    const checkedConfigPath =
      typeof details.checkedConfigPath === "string" && details.checkedConfigPath.trim().length > 0
        ? details.checkedConfigPath
        : "(not found)";
    lines.push(`- config: ${checkedConfigPath}`);
    pushList(lines, "issues", asStringArray(details.issues));
    pushList(lines, "warnings", asStringArray(details.warnings));
    pushList(lines, "missing subagents", asStringArray(details.missingSubagents));
    pushList(lines, "missing mcps", asStringArray(details.missingMcps));
    pushList(lines, "missing providers", asStringArray(details.missingProviders));
    pushList(lines, "missing auth plugins", asStringArray(details.missingAuthPlugins));
  }

  const actions = new Set<string>();
  const hasCheck = (name: string, status?: CheckStatus) =>
    report.checks.some((check) => check.name === name && (status ? check.status === status : true));
  if (hasCheck("build.artifact", "fail")) {
    actions.add("Run: bun run build");
  }
  if (hasCheck("benchmark.fixtures", "fail") || hasCheck("benchmark.results", "warn")) {
    actions.add("Run: bun run benchmark:generate");
  }
  if (hasCheck("benchmark.quality_gate", "fail")) {
    actions.add("Run: bun run benchmark:score");
  }
  if (hasCheck("orchestrator.readiness", "fail")) {
    actions.add("Apply mappings/config: npx -y oh-my-aegis install (or global: oh-my-aegis install)");
  }

  if (actions.size > 0) {
    lines.push("", "next steps:");
    let index = 1;
    for (const action of actions) {
      lines.push(`${index}. ${action}`);
      index += 1;
    }
  }

  lines.push("", "tip: use `oh-my-aegis doctor --json` for machine-readable output.");
  return lines.join("\n");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function runDoctor(projectDir: string): DoctorReport {
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "runtime.bun",
    status: typeof Bun.version === "string" ? "pass" : "fail",
    message: typeof Bun.version === "string" ? `bun ${Bun.version}` : "Bun runtime not detected",
  });

  const distIndexPath = join(projectDir, "dist", "index.js");
  checks.push({
    name: "build.artifact",
    status: existsSync(distIndexPath) ? "pass" : "fail",
    message: existsSync(distIndexPath) ? `Found build artifact: ${distIndexPath}` : `Missing build artifact: ${distIndexPath}`,
  });

  const fixturePath = join(projectDir, "benchmarks", "fixtures", "domain-fixtures.json");
  checks.push({
    name: "benchmark.fixtures",
    status: existsSync(fixturePath) ? "pass" : "fail",
    message: existsSync(fixturePath) ? `Found benchmark fixtures: ${fixturePath}` : `Missing benchmark fixtures: ${fixturePath}`,
  });

  const resultsPath = join(projectDir, "benchmarks", "results.json");
  if (!existsSync(resultsPath)) {
    checks.push({
      name: "benchmark.results",
      status: "warn",
      message: "benchmarks/results.json not found. Run 'bun run benchmark:generate'.",
    });
  } else {
    try {
      const manifest = parseBenchmarkManifest(readJson(resultsPath));
      const score = scoreBenchmark(manifest, 1, {
        evidenceExists: (evidencePath) => {
          const resolvedPath = isAbsolute(evidencePath) ? evidencePath : resolve(projectDir, evidencePath);
          return existsSync(resolvedPath);
        },
      });
      const status: CheckStatus = score.qualityGate.verdict === "perfect" ? "pass" : "fail";
      checks.push({
        name: "benchmark.quality_gate",
        status,
        message: status === "pass" ? "Benchmark quality gate is perfect." : "Benchmark quality gate is needs_work.",
        details: {
          verdict: score.qualityGate.verdict,
          missingDomains: score.qualityGate.missingDomains,
          missingEvidence: score.qualityGate.missingEvidence,
        },
      });
    } catch (error) {
      checks.push({
        name: "benchmark.quality_gate",
        status: "fail",
        message: `Failed to score benchmarks: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  try {
    const configWarnings: string[] = [];
    const config = loadConfig(projectDir, { onWarning: (msg) => configWarnings.push(msg) });
    const notesStore = new NotesStore(projectDir, config.markdown_budget);
    const readiness = buildReadinessReport(projectDir, notesStore, config);
    if (configWarnings.length > 0) {
      checks.push({
        name: "config.warnings",
        status: "warn",
        message: `Config parse/validation warnings (${configWarnings.length}).`,
        details: { warnings: configWarnings.slice(0, 20) },
      });
    }
    checks.push({
      name: "orchestrator.readiness",
      status: readiness.ok ? "pass" : "fail",
      message: readiness.ok ? "Readiness check passed." : "Readiness check failed.",
      details: {
        checkedConfigPath: readiness.checkedConfigPath,
        issues: readiness.issues,
        warnings: readiness.warnings,
        missingSubagents: readiness.missingSubagents,
        missingMcps: readiness.missingMcps,
        missingProviders: readiness.missingProviders,
        missingAuthPlugins: readiness.missingAuthPlugins,
      },
    });
  } catch (error) {
    checks.push({
      name: "orchestrator.readiness",
      status: "fail",
      message: `Failed to run readiness check: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const hasFail = checks.some((check) => check.status === "fail");
  return {
    ok: !hasFail,
    generatedAt: new Date().toISOString(),
    projectDir,
    checks,
  };
}
