import { describe, expect, it } from "bun:test";
import { isActionableIntent, buildIntentGateSection } from "../src/orchestration/intent-gate";
import { DEFAULT_STATE } from "../src/state/types";

describe("isActionableIntent", () => {
  it("returns true for implement", () => {
    expect(isActionableIntent("implement")).toBe(true);
  });

  it("returns true for fix", () => {
    expect(isActionableIntent("fix")).toBe(true);
  });

  it("returns false for research", () => {
    expect(isActionableIntent("research")).toBe(false);
  });

  it("returns false for investigate", () => {
    expect(isActionableIntent("investigate")).toBe(false);
  });

  it("returns false for evaluate", () => {
    expect(isActionableIntent("evaluate")).toBe(false);
  });

  it("returns false for unknown", () => {
    expect(isActionableIntent("unknown")).toBe(false);
  });
});

describe("buildIntentGateSection", () => {
  it("always starts with [INTENT GATE]", () => {
    for (const intentType of ["unknown", "research", "implement", "investigate", "evaluate", "fix"] as const) {
      const result = buildIntentGateSection({ ...DEFAULT_STATE, intentType });
      expect(result.startsWith("[INTENT GATE]")).toBe(true);
    }
  });

  it("unknown intent → ACTION REQUIRED + ctf_orch_event", () => {
    const result = buildIntentGateSection({ ...DEFAULT_STATE, intentType: "unknown" });
    expect(result).toContain("ACTION REQUIRED");
    expect(result).toContain("ctf_orch_event");
  });

  it("research intent → RESEARCH MODE, no ACTION REQUIRED", () => {
    const result = buildIntentGateSection({ ...DEFAULT_STATE, intentType: "research" });
    expect(result).toContain("RESEARCH MODE");
    expect(result).not.toContain("ACTION REQUIRED");
  });

  it("implement intent → IMPLEMENT MODE", () => {
    const result = buildIntentGateSection({ ...DEFAULT_STATE, intentType: "implement" });
    expect(result).toContain("IMPLEMENT MODE");
  });

  it("fix intent → FIX MODE", () => {
    const result = buildIntentGateSection({ ...DEFAULT_STATE, intentType: "fix" });
    expect(result).toContain("FIX MODE");
  });

  it("investigate intent → INVESTIGATE MODE", () => {
    const result = buildIntentGateSection({ ...DEFAULT_STATE, intentType: "investigate" });
    expect(result).toContain("INVESTIGATE MODE");
  });

  it("evaluate intent → EVALUATE MODE", () => {
    const result = buildIntentGateSection({ ...DEFAULT_STATE, intentType: "evaluate" });
    expect(result).toContain("EVALUATE MODE");
  });
});
