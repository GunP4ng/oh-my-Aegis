import { describe, expect, it } from "bun:test";
import { formatDelegationContract, buildDelegationContractSection } from "../src/orchestration/delegation-contract";
import { DEFAULT_STATE } from "../src/state/types";

describe("formatDelegationContract", () => {
  const base = {
    task: "analyze binary",
    expectedOutcome: "vulnerability class identified",
    requiredTools: ["readelf", "strings"],
    mustDo: ["check symbols", "verify sections"],
    mustNotDo: ["guess without evidence"],
    context: "phase=EXECUTE targetType=REV",
  };

  it("output contains [DELEGATION CONTRACT]", () => {
    expect(formatDelegationContract(base)).toContain("[DELEGATION CONTRACT]");
  });

  it("contains all 6 required sections", () => {
    const result = formatDelegationContract(base);
    expect(result).toContain("TASK:");
    expect(result).toContain("EXPECTED_OUTCOME:");
    expect(result).toContain("REQUIRED_TOOLS:");
    expect(result).toContain("MUST_DO:");
    expect(result).toContain("MUST_NOT_DO:");
    expect(result).toContain("CONTEXT:");
  });

  it("mustDo items have '  - ' prefix", () => {
    const result = formatDelegationContract(base);
    expect(result).toContain("  - check symbols");
    expect(result).toContain("  - verify sections");
  });

  it("mustNotDo items have '  - ' prefix", () => {
    const result = formatDelegationContract(base);
    expect(result).toContain("  - guess without evidence");
  });

  it("requiredTools are comma-separated", () => {
    const result = formatDelegationContract(base);
    expect(result).toContain("readelf, strings");
  });
});

describe("buildDelegationContractSection", () => {
  it("CTF + REV → REV example included", () => {
    const result = buildDelegationContractSection({ ...DEFAULT_STATE, mode: "CTF", targetType: "REV" });
    expect(result).toContain("EXAMPLE (REV)");
    expect(result).toContain("session_id");
  });

  it("CTF + PWN → PWN example included", () => {
    const result = buildDelegationContractSection({ ...DEFAULT_STATE, mode: "CTF", targetType: "PWN" });
    expect(result).toContain("EXAMPLE (PWN)");
    expect(result).toContain("session_id");
  });

  it("CTF + WEB_API → WEB example included", () => {
    const result = buildDelegationContractSection({ ...DEFAULT_STATE, mode: "CTF", targetType: "WEB_API" });
    expect(result).toContain("EXAMPLE (WEB)");
    expect(result).toContain("session_id");
  });

  it("BOUNTY → no domain example", () => {
    const result = buildDelegationContractSection({ ...DEFAULT_STATE, mode: "BOUNTY" });
    expect(result).not.toContain("EXAMPLE (REV)");
    expect(result).not.toContain("EXAMPLE (PWN)");
    expect(result).not.toContain("EXAMPLE (WEB)");
  });

  it("all cases contain session_id (session continuity rule)", () => {
    for (const targetType of ["REV", "PWN", "WEB_API", "CRYPTO", "FORENSICS"] as const) {
      const result = buildDelegationContractSection({ ...DEFAULT_STATE, mode: "CTF", targetType });
      expect(result).toContain("session_id");
    }
    // BOUNTY mode도 session continuity 규약 포함
    const bountyResult = buildDelegationContractSection({ ...DEFAULT_STATE, mode: "BOUNTY" });
    expect(bountyResult).toContain("session_id");
  });
});
