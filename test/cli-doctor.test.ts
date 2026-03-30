import { describe, expect, it } from "bun:test";
import { formatDoctorReport, runDoctor, type DoctorReport } from "../src/cli/doctor";

describe("cli doctor formatter", () => {
  it("renders readable summary, check list, readiness details, and next steps", () => {
    const report: DoctorReport = {
      ok: false,
      generatedAt: "2026-02-23T00:00:00.000Z",
      projectDir: "/tmp/project",
      checks: [
        {
          name: "runtime.bun",
          status: "pass",
          message: "bun 1.3.5",
        },
        {
          name: "build.artifact",
          status: "fail",
          message: "Missing build artifact: /tmp/project/dist/oh-my-aegis.js",
        },
        {
          name: "benchmark.results",
          status: "warn",
          message: "benchmarks/results.json not found. Run 'bun run benchmark:generate'.",
        },
        {
          name: "orchestrator.readiness",
          status: "fail",
          message: "Readiness check failed.",
          details: {
            checkedConfigPath: "/tmp/project/opencode.json",
            issues: ["i1", "i2", "i3", "i4", "i5", "i6", "i7"],
            warnings: ["w1"],
            missingSubagents: ["a", "b"],
            missingMcps: ["m1"],
            missingProviders: [],
            missingAuthPlugins: [],
          },
        },
      ],
    };

    const text = formatDoctorReport(report);
    expect(text).toContain("oh-my-Aegis doctor");
    expect(text).toContain("result: FAIL (pass=1, warn=1, fail=2)");
    expect(text).toContain("- [FAIL] build.artifact: Missing build artifact: /tmp/project/dist/oh-my-aegis.js");
    expect(text).toContain("readiness details:");
    expect(text).toContain("- issues (7):");
    expect(text).toContain("  - ... +1 more");
    expect(text).toContain("next steps:");
    expect(text).toContain("1. Run: bun run build");
    expect(text).toContain("2. Run: bun run benchmark:generate");
  });

  it("prints PASS summary and json tip when all checks pass", () => {
    const report: DoctorReport = {
      ok: true,
      generatedAt: "2026-02-23T00:00:00.000Z",
      projectDir: "/tmp/project",
      checks: [
        {
          name: "runtime.bun",
          status: "pass",
          message: "bun 1.3.5",
        },
      ],
    };

    const text = formatDoctorReport(report);
    expect(text).toContain("result: PASS (pass=1, warn=0, fail=0)");
    expect(text).toContain("tip: use `oh-my-aegis doctor --json` for machine-readable output.");
  });
});

describe("doctor checks: storage.*", () => {
  it("storage.schema_version passes when state file is absent", () => {
    // Use a temp dir with no .Aegis directory
    const { mkdtempSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(require("node:path").join(tmpdir(), "doctor-test-"));
    const report = runDoctor(dir);
    const schemaCheck = report.checks.find((c) => c.name === "storage.schema_version");
    expect(schemaCheck).toBeDefined();
    expect(schemaCheck!.status).toBe("pass");
    expect(schemaCheck!.message).toContain("fresh install");
    require("node:fs").rmSync(dir, { recursive: true, force: true });
  });

  it("storage.schema_version warns when schema version is wrong", () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    const dir = mkdtempSync(join(tmpdir(), "doctor-test-sv-"));
    const aegisDir = join(dir, ".Aegis");
    mkdirSync(aegisDir, { recursive: true });
    writeFileSync(join(aegisDir, "orchestrator_state.json"), JSON.stringify({ schemaVersion: 99 }));
    const report = runDoctor(dir);
    const schemaCheck = report.checks.find((c) => c.name === "storage.schema_version");
    expect(schemaCheck).toBeDefined();
    expect(schemaCheck!.status).toBe("warn");
    expect(schemaCheck!.message).toContain("99");
    rmSync(dir, { recursive: true, force: true });
  });

  it("storage.file_sizes passes when no large files exist", () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    const dir = mkdtempSync(join(tmpdir(), "doctor-test-fs-"));
    mkdirSync(join(dir, ".Aegis"), { recursive: true });
    writeFileSync(join(dir, ".Aegis", "orchestrator_state.json"), JSON.stringify({ schemaVersion: 2 }));
    writeFileSync(join(dir, ".Aegis", "latency.jsonl"), "small\n");
    const report = runDoctor(dir);
    const fileSizeCheck = report.checks.find((c) => c.name === "storage.file_sizes");
    expect(fileSizeCheck).toBeDefined();
    expect(fileSizeCheck!.status).toBe("pass");
    rmSync(dir, { recursive: true, force: true });
  });

  it("storage.instance_lock passes when no lock file exists", () => {
    const { mkdtempSync, rmSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(require("node:path").join(tmpdir(), "doctor-test-lock-"));
    const report = runDoctor(dir);
    const lockCheck = report.checks.find((c) => c.name === "storage.instance_lock");
    expect(lockCheck).toBeDefined();
    expect(lockCheck!.status).toBe("pass");
    expect(lockCheck!.message).toContain("No instance lock file found");
    rmSync(dir, { recursive: true, force: true });
  });

  it("storage.instance_lock warns when lock is held by running process", () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    const dir = mkdtempSync(join(tmpdir(), "doctor-test-lock2-"));
    mkdirSync(join(dir, ".Aegis"), { recursive: true });
    // Write lock with current process PID (guaranteed alive)
    const lockInfo = { pid: process.pid, startedAt: Date.now() };
    writeFileSync(join(dir, ".Aegis", "instance.lock"), JSON.stringify(lockInfo));
    const report = runDoctor(dir);
    const lockCheck = report.checks.find((c) => c.name === "storage.instance_lock");
    expect(lockCheck).toBeDefined();
    expect(lockCheck!.status).toBe("warn");
    expect(lockCheck!.message).toContain(String(process.pid));
    rmSync(dir, { recursive: true, force: true });
  });

  it("storage.instance_lock passes when lock has dead PID", () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    const dir = mkdtempSync(join(tmpdir(), "doctor-test-lock3-"));
    mkdirSync(join(dir, ".Aegis"), { recursive: true });
    // Write lock with a PID that does not exist
    const lockInfo = { pid: 99999999, startedAt: Date.now() - 100000 };
    writeFileSync(join(dir, ".Aegis", "instance.lock"), JSON.stringify(lockInfo));
    const report = runDoctor(dir);
    const lockCheck = report.checks.find((c) => c.name === "storage.instance_lock");
    expect(lockCheck).toBeDefined();
    expect(lockCheck!.status).toBe("pass");
    expect(lockCheck!.message).toContain("Stale");
    rmSync(dir, { recursive: true, force: true });
  });
});
