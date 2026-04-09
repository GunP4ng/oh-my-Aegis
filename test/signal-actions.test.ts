import { describe, expect, it } from "bun:test";
import {
  buildSignalGuidance,
  buildPhaseInstruction,
  buildDelegateBiasSection,
  buildParallelRulesSection,
  buildProblemStateSection,
  buildHardBlocksSection,
  buildRouteTransparencySection,
  buildAvailableSubagentsSection,
} from "../src/orchestration/signal-actions";
import { DEFAULT_STATE } from "../src/state/types";

describe("buildSignalGuidance", () => {
  it("returns [] for clean default state", () => {
    expect(buildSignalGuidance(DEFAULT_STATE)).toEqual([]);
  });

  it("includes VM detection warning when revVmSuspected", () => {
    const result = buildSignalGuidance({ ...DEFAULT_STATE, revVmSuspected: true });
    expect(result.some((s) => s.includes("VM DETECTED"))).toBe(true);
  });

  it("includes decoy warning with reason when decoySuspect + decoySuspectReason", () => {
    const result = buildSignalGuidance({ ...DEFAULT_STATE, decoySuspect: true, decoySuspectReason: "test-reason" });
    expect(result.some((s) => s.includes("DECOY SUSPECT") && s.includes("test-reason"))).toBe(true);
  });

  it("includes STUCK warning when noNewEvidenceLoops >= 2", () => {
    const result = buildSignalGuidance({ ...DEFAULT_STATE, noNewEvidenceLoops: 2 });
    expect(result.some((s) => s.includes("STUCK"))).toBe(true);
  });

  it("does NOT include STUCK warning when noNewEvidenceLoops < 2", () => {
    const result = buildSignalGuidance({ ...DEFAULT_STATE, noNewEvidenceLoops: 1 });
    expect(result.some((s) => s.includes("STUCK"))).toBe(false);
  });

  it("includes HIGH REV RISK warning when revRiskScore > 0.3", () => {
    const result = buildSignalGuidance({ ...DEFAULT_STATE, revRiskScore: 0.5 });
    expect(result.some((s) => s.includes("HIGH REV RISK"))).toBe(true);
  });

  it("includes repeated verify failures warning when verifyFailCount >= 2", () => {
    const result = buildSignalGuidance({ ...DEFAULT_STATE, verifyFailCount: 2 });
    expect(result.some((s) => s.includes("REPEATED VERIFY FAILURES"))).toBe(true);
  });

  it("includes AEGIS TOOLS NOT USED when toolCallCount > 20 and aegisToolCallCount === 0", () => {
    const result = buildSignalGuidance({ ...DEFAULT_STATE, toolCallCount: 25, aegisToolCallCount: 0 });
    expect(result.some((s) => s.includes("AEGIS TOOLS NOT USED"))).toBe(true);
  });

  it("planning role stuck guidance avoids denied hypothesis tool directions", () => {
    const result = buildSignalGuidance(
      { ...DEFAULT_STATE, noNewEvidenceLoops: 2 },
      undefined,
      "planning"
    );
    expect(result.some((s) => s.includes("ctf_hypothesis_register"))).toBe(false);
  });
});

describe("buildPhaseInstruction", () => {
  it("SCAN phase → contains ctf_auto_triage and scan_completed", () => {
    const result = buildPhaseInstruction({ ...DEFAULT_STATE, phase: "SCAN" });
    expect(result).toContain("ctf_auto_triage");
    expect(result).toContain("scan_completed");
    expect(result).toContain("2-3 parallel");
  });

  it("PLAN phase → contains ctf_hypothesis_register and plan_completed", () => {
    const result = buildPhaseInstruction({ ...DEFAULT_STATE, phase: "PLAN" });
    expect(result).toContain("ctf_hypothesis_register");
    expect(result).toContain("plan_completed");
  });

  it("manager PLAN phase omits direct hypothesis tool instructions", () => {
    const result = buildPhaseInstruction({ ...DEFAULT_STATE, phase: "PLAN" }, "manager");
    expect(result).toContain("plan_completed");
    expect(result).not.toContain("ctf_hypothesis_register");
  });

  it("EXECUTE phase → contains candidate_found and evidence", () => {
    const result = buildPhaseInstruction({ ...DEFAULT_STATE, phase: "EXECUTE" });
    expect(result).toContain("candidate_found");
    expect(result).toContain("ctf_evidence_ledger");
  });

  it("VERIFY phase → contains verify_success and verify_fail", () => {
    const result = buildPhaseInstruction({ ...DEFAULT_STATE, phase: "VERIFY" });
    expect(result).toContain("verify_success");
    expect(result).toContain("verify_fail");
  });

  it("SUBMIT phase → returns non-empty string", () => {
    const result = buildPhaseInstruction({ ...DEFAULT_STATE, phase: "SUBMIT" });
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("buildDelegateBiasSection", () => {
  it("starts with [ORCHESTRATION ROLE]", () => {
    const result = buildDelegateBiasSection(DEFAULT_STATE);
    expect(result).toContain("[ORCHESTRATION ROLE]");
  });

  it("contains Delegate first", () => {
    const result = buildDelegateBiasSection(DEFAULT_STATE);
    expect(result).toContain("Delegate first");
  });
});

describe("buildParallelRulesSection", () => {
  it("SCAN → 2-3 parallel", () => {
    const result = buildParallelRulesSection({ ...DEFAULT_STATE, phase: "SCAN" });
    expect(result).toContain("2-3");
  });

  it("VERIFY → ctf_decoy_guard", () => {
    const result = buildParallelRulesSection({ ...DEFAULT_STATE, phase: "VERIFY" });
    expect(result).toContain("ctf_decoy_guard");
  });

  it("manager VERIFY parallel rules avoid direct decoy tool instructions", () => {
    const result = buildParallelRulesSection({ ...DEFAULT_STATE, phase: "VERIFY" }, "manager");
    expect(result).not.toContain("ctf_decoy_guard");
    expect(result).toContain("decoy review");
  });
});

describe("buildProblemStateSection", () => {
  it("unknown problemStateClass → empty string", () => {
    const result = buildProblemStateSection({ ...DEFAULT_STATE, problemStateClass: "unknown" });
    expect(result).toBe("");
  });

  it("deceptive → contains [PROBLEM STATE]", () => {
    const result = buildProblemStateSection({ ...DEFAULT_STATE, problemStateClass: "deceptive" });
    expect(result).toContain("[PROBLEM STATE]");
    expect(result).toContain("deceptive");
  });

  it("clean → contains [PROBLEM STATE]", () => {
    const result = buildProblemStateSection({ ...DEFAULT_STATE, problemStateClass: "clean" });
    expect(result).toContain("[PROBLEM STATE]");
  });
});

describe("buildHardBlocksSection", () => {
  it("contains [HARD BLOCKS", () => {
    const result = buildHardBlocksSection();
    expect(result).toContain("[HARD BLOCKS");
  });

  it("contains 6 prohibited patterns (✗)", () => {
    const result = buildHardBlocksSection();
    const count = (result.match(/✗/g) ?? []).length;
    expect(count).toBe(6);
  });
});

describe("buildRouteTransparencySection", () => {
  it("contains route, reason, and phase", () => {
    const result = buildRouteTransparencySection(
      { ...DEFAULT_STATE, phase: "EXECUTE", targetType: "REV" },
      "ctf-rev",
      "phase+targetType match"
    );
    expect(result).toContain("ctf-rev");
    expect(result).toContain("phase+targetType match");
    expect(result).toContain("EXECUTE");
  });
});

describe("buildAvailableSubagentsSection", () => {
  it("empty list → empty string", () => {
    const result = buildAvailableSubagentsSection(DEFAULT_STATE, []);
    expect(result).toBe("");
  });

  it("REV target → REV domain hint", () => {
    const result = buildAvailableSubagentsSection(
      { ...DEFAULT_STATE, targetType: "REV" },
      ["ctf-rev", "aegis-deep"]
    );
    expect(result).toContain("ctf-rev");
    expect(result).toContain("static analysis");
  });
});
