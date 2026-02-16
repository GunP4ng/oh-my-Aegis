import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { scoreBenchmark, parseBenchmarkManifest } from "../benchmark/scoring";
import { buildReadinessReport } from "../config/readiness";
import { loadConfig } from "../config/loader";
import { NotesStore } from "../state/notes-store";

type CheckStatus = "pass" | "warn" | "fail";

interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

interface DoctorReport {
  ok: boolean;
  generatedAt: string;
  projectDir: string;
  checks: DoctorCheck[];
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
    const config = loadConfig(projectDir);
    const notesStore = new NotesStore(projectDir, config.markdown_budget);
    const readiness = buildReadinessReport(projectDir, notesStore, config);
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
