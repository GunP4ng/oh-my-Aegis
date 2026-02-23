import { describe, expect, it } from "bun:test";
import { formatDoctorReport, type DoctorReport } from "../src/cli/doctor";

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
          message: "Missing build artifact: /tmp/project/dist/index.js",
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
    expect(text).toContain("- [FAIL] build.artifact: Missing build artifact: /tmp/project/dist/index.js");
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
