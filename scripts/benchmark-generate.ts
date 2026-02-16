import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { z } from "zod";
import OhMyAegisPlugin from "../src/index";
import { BENCHMARK_DOMAINS, type BenchmarkDomain } from "../src/benchmark/scoring";
import { OrchestratorConfigSchema } from "../src/config/schema";
import { createBuiltinMcps } from "../src/mcp";
import { requiredDispatchSubagents } from "../src/orchestration/task-dispatch";

const ROOT_DIR = process.cwd();
const BENCHMARK_DIR = join(ROOT_DIR, "benchmarks");
const FIXTURE_PATH = join(BENCHMARK_DIR, "fixtures", "domain-fixtures.json");
const RESULTS_PATH = join(BENCHMARK_DIR, "results.json");
const EVIDENCE_ROOT = join(BENCHMARK_DIR, "evidence");

const EVENT_VALUES = [
  "scan_completed",
  "plan_completed",
  "candidate_found",
  "verify_success",
  "verify_fail",
  "no_new_evidence",
  "same_payload_repeat",
  "new_evidence",
  "readonly_inconclusive",
  "scope_confirmed",
  "context_length_exceeded",
  "timeout",
  "reset_loop",
] as const;

const TARGET_TYPE_VALUES = [...BENCHMARK_DOMAINS, "UNKNOWN"] as const;

const FAILURE_REASON_VALUES = [
  "verification_mismatch",
  "tooling_timeout",
  "context_overflow",
  "hypothesis_stall",
  "exploit_chain",
  "environment",
] as const;

const FixtureStepSchema = z.object({
  event: z.enum(EVENT_VALUES),
  target_type: z.enum(TARGET_TYPE_VALUES).optional(),
  candidate: z.string().optional(),
  verified: z.string().optional(),
  hypothesis: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  failure_reason: z.enum(FAILURE_REASON_VALUES).optional(),
  failed_route: z.string().optional(),
  failure_summary: z.string().optional(),
});

const FixtureCaseSchema = z.object({
  domain: z.enum(BENCHMARK_DOMAINS),
  id: z.string().min(1),
  mode: z.enum(["CTF", "BOUNTY"]),
  target_type: z.enum(TARGET_TYPE_VALUES).optional(),
  events: z.array(z.enum(EVENT_VALUES)).optional(),
  steps: z.array(FixtureStepSchema).optional(),
  expected_primary: z.string().min(1),
  expected_followups_include: z.array(z.string()).default([]),
  expected_reason_includes: z.array(z.string()).default([]),
  require_readiness_ok: z.boolean().default(true),
  notes: z.string().optional(),
});

const FixtureFileSchema = z.object({
  cases: z.array(FixtureCaseSchema).min(1),
});

type FixtureCase = z.infer<typeof FixtureCaseSchema>;
type FixtureStep = z.infer<typeof FixtureStepSchema>;

interface BenchmarkRun {
  domain: BenchmarkDomain;
  id: string;
  status: "pass" | "fail" | "skip";
  evidence: string;
  notes?: string;
}

async function loadHooks(projectDir: string) {
  return OhMyAegisPlugin({
    client: {} as never,
    project: {} as never,
    directory: projectDir,
    worktree: projectDir,
    serverUrl: new URL("http://localhost"),
    $: {} as never,
  });
}

function toPosixPath(path: string): string {
  return path.split("\\").join("/");
}

function setupHarnessRoot(root: string): { projectDir: string } {
  const projectDir = join(root, "project");
  const xdgConfigRoot = join(root, ".config");
  const opencodeDir = join(xdgConfigRoot, "opencode");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(opencodeDir, { recursive: true });

  const defaultConfig = OrchestratorConfigSchema.parse({
    enforce_mode_header: false,
  });
  const requiredAgents = new Set(requiredDispatchSubagents(defaultConfig));
  requiredAgents.add(defaultConfig.failover.map.explore);
  requiredAgents.add(defaultConfig.failover.map.librarian);
  requiredAgents.add(defaultConfig.failover.map.oracle);

  const agentMap: Record<string, Record<string, never>> = {};
  for (const name of requiredAgents) {
    agentMap[name] = {};
  }

  const opencodeConfig = {
    agent: agentMap,
    mcp: createBuiltinMcps({
      projectDir,
      disabledMcps: defaultConfig.disabled_mcps,
      memoryStorageDir: defaultConfig.memory.storage_dir,
    }),
  };
  writeFileSync(join(opencodeDir, "opencode.json"), `${JSON.stringify(opencodeConfig, null, 2)}\n`, "utf-8");
  writeFileSync(
    join(opencodeDir, "oh-my-Aegis.json"),
    `${JSON.stringify(defaultConfig, null, 2)}\n`,
    "utf-8"
  );

  process.env.HOME = root;
  process.env.XDG_CONFIG_HOME = xdgConfigRoot;

  return { projectDir };
}

function readFixtures(): FixtureCase[] {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const fixtureFile = FixtureFileSchema.parse(parsed);
  return fixtureFile.cases;
}

function fixtureSteps(fixture: FixtureCase): FixtureStep[] {
  if (Array.isArray(fixture.steps) && fixture.steps.length > 0) {
    return fixture.steps;
  }
  if (Array.isArray(fixture.events) && fixture.events.length > 0) {
    return fixture.events.map((event) => ({ event }));
  }
  return [{ event: "scan_completed" }, { event: "plan_completed" }];
}

function validateFixtureCoverage(fixtures: FixtureCase[]): void {
  const modeCoverage: Record<"CTF" | "BOUNTY", Set<BenchmarkDomain>> = {
    CTF: new Set(),
    BOUNTY: new Set(),
  };
  const ids = new Set<string>();

  for (const fixture of fixtures) {
    if (ids.has(fixture.id)) {
      throw new Error(`Duplicate fixture id: ${fixture.id}`);
    }
    ids.add(fixture.id);
    modeCoverage[fixture.mode].add(fixture.domain);
  }

  const missing: string[] = [];
  for (const mode of ["CTF", "BOUNTY"] as const) {
    for (const domain of BENCHMARK_DOMAINS) {
      if (!modeCoverage[mode].has(domain)) {
        missing.push(`${mode}:${domain}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Fixture coverage incomplete. Missing mode/domain pairs: ${missing.join(", ")}`);
  }
}

async function runFixture(
  hooks: Awaited<ReturnType<typeof loadHooks>>,
  fixture: FixtureCase,
  generatedAt: string
): Promise<BenchmarkRun> {
  const sessionID = `benchmark-${fixture.id}`;
  const targetType = fixture.target_type ?? fixture.domain;
  await hooks.tool?.ctf_orch_set_mode.execute(
    {
      mode: fixture.mode,
      session_id: sessionID,
    },
    { sessionID } as never
  );

  for (const step of fixtureSteps(fixture)) {
    await hooks.tool?.ctf_orch_event.execute(
      {
        event: step.event,
        target_type: step.target_type ?? targetType,
        candidate: step.candidate,
        verified: step.verified,
        hypothesis: step.hypothesis,
        alternatives: step.alternatives,
        failure_reason: step.failure_reason,
        failed_route: step.failed_route,
        failure_summary: step.failure_summary,
        session_id: sessionID,
      },
      { sessionID } as never
    );
  }

  const statusRaw = await hooks.tool?.ctf_orch_status.execute({ session_id: sessionID }, { sessionID } as never);
  const readinessRaw = await hooks.tool?.ctf_orch_readiness.execute({}, { sessionID } as never);
  const status = JSON.parse(statusRaw ?? "{}");
  const readiness = JSON.parse(readinessRaw ?? "{}");

  const actualPrimary = String(status?.decision?.primary ?? "");
  const actualReason = String(status?.decision?.reason ?? "");
  const actualFollowups = Array.isArray(status?.decision?.followups)
    ? status.decision.followups.map((item: unknown) => String(item))
    : [];
  const followupsSatisfied = fixture.expected_followups_include.every((expected) => actualFollowups.includes(expected));
  const reasonSatisfied = fixture.expected_reason_includes.every((expected) =>
    actualReason.toLowerCase().includes(expected.toLowerCase())
  );
  const readinessSatisfied = fixture.require_readiness_ok ? readiness?.ok === true : true;
  const pass = actualPrimary === fixture.expected_primary && followupsSatisfied && reasonSatisfied && readinessSatisfied;

  const evidenceDir = join(EVIDENCE_ROOT, fixture.domain.toLowerCase());
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = join(evidenceDir, `${fixture.id}.json`);
  const evidencePayload = {
    generatedAt,
    fixture,
    pass,
    expectedPrimary: fixture.expected_primary,
    actualPrimary,
    expectedFollowupsInclude: fixture.expected_followups_include,
    actualFollowups,
    expectedReasonIncludes: fixture.expected_reason_includes,
    decisionReason: actualReason,
    checks: {
      primary: actualPrimary === fixture.expected_primary,
      followups: followupsSatisfied,
      reason: reasonSatisfied,
      readiness: readinessSatisfied,
    },
    readinessOK: readiness?.ok === true,
    state: status?.state ?? {},
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidencePayload, null, 2)}\n`, "utf-8");

  const evidenceRelative = toPosixPath(relative(ROOT_DIR, evidencePath));
  const notes = pass
    ? fixture.notes ?? "Fixture scenario passed."
    : [
        `expected primary='${fixture.expected_primary}', actual='${actualPrimary}'`,
        `expected followups include=[${fixture.expected_followups_include.join(", ")}], actual=[${actualFollowups.join(", ")}]`,
        `reason includes=[${fixture.expected_reason_includes.join(", ")}], actual='${actualReason}'`,
        `readiness.ok=${String(readiness?.ok)}`,
      ].join(" | ");

  return {
    domain: fixture.domain,
    id: fixture.id,
    status: pass ? "pass" : "fail",
    evidence: evidenceRelative,
    notes,
  };
}

async function main(): Promise<void> {
  const originalHome = process.env.HOME;
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const harnessRoot = join(tmpdir(), `aegis-benchmark-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  try {
    rmSync(EVIDENCE_ROOT, { recursive: true, force: true });
    mkdirSync(EVIDENCE_ROOT, { recursive: true });
    const fixtures = readFixtures();
    validateFixtureCoverage(fixtures);
    const { projectDir } = setupHarnessRoot(harnessRoot);
    const hooks = await loadHooks(projectDir);
    const generatedAt = new Date().toISOString();

    const runs: BenchmarkRun[] = [];
    for (const fixture of fixtures) {
      const run = await runFixture(hooks, fixture, generatedAt);
      runs.push(run);
    }

    const payload = { runs };
    writeFileSync(RESULTS_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

    const passCount = runs.filter((run) => run.status === "pass").length;
    const failCount = runs.filter((run) => run.status === "fail").length;
    process.stdout.write(
      [
        `Benchmark fixtures generated: ${runs.length}`,
        `- pass: ${passCount}`,
        `- fail: ${failCount}`,
        `- results: ${toPosixPath(relative(ROOT_DIR, RESULTS_PATH))}`,
        `- evidence root: ${toPosixPath(relative(ROOT_DIR, EVIDENCE_ROOT))}`,
      ].join("\n") + "\n"
    );

    if (failCount > 0) {
      process.exitCode = 2;
    }
  } finally {
    process.env.HOME = originalHome;
    process.env.XDG_CONFIG_HOME = originalXdg;
    rmSync(harnessRoot, { recursive: true, force: true });
  }
}

await main();
