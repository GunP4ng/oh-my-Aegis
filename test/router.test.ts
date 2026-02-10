import { describe, expect, it } from "bun:test";
import { resolveFailoverAgent, route } from "../src/orchestration/router";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";

function makeState(overrides: Partial<SessionState>): SessionState {
  return { ...DEFAULT_STATE, ...overrides, lastUpdatedAt: 0 };
}

describe("router", () => {
  it("routes bounty sessions without scope to bounty-scope", () => {
    const decision = route(makeState({ mode: "BOUNTY", scopeConfirmed: false }));
    expect(decision.primary).toBe("bounty-scope");
  });

  it("routes stuck ctf web/api to ctf-research", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "WEB_API",
        noNewEvidenceLoops: 2,
      })
    );
    expect(decision.primary).toBe("ctf-research");
  });

  it("routes stuck ctf forensics to ctf-forensics", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "FORENSICS",
        noNewEvidenceLoops: 2,
      })
    );
    expect(decision.primary).toBe("ctf-forensics");
  });

  it("routes low-risk ctf candidate directly to verify", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        candidatePendingVerification: true,
        targetType: "PWN",
        latestCandidate: "flag{candidate}",
      })
    );
    expect(decision.primary).toBe("ctf-verify");
  });

  it("routes risky ctf candidate through decoy-check first", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        candidatePendingVerification: true,
        targetType: "WEB_API",
      })
    );
    expect(decision.primary).toBe("ctf-decoy-check");
    expect(decision.followups).toContain("ctf-verify");
  });

  it("routes empty candidate through decoy-check first", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        candidatePendingVerification: true,
        targetType: "PWN",
        latestCandidate: "",
      })
    );
    expect(decision.primary).toBe("ctf-decoy-check");
  });

  it("routes verification mismatch failures to decoy-check retry loop", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "PWN",
        lastFailureReason: "verification_mismatch",
      })
    );
    expect(decision.primary).toBe("ctf-decoy-check");
  });

  it("routes timeout failures to target failover route", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "WEB3",
        lastFailureReason: "tooling_timeout",
      })
    );
    expect(decision.primary).toBe("ctf-research");
  });

  it("routes repeated context failures to md-scribe first", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        contextFailCount: 2,
      })
    );
    expect(decision.primary).toBe("md-scribe");
  });

  it("routes ctf scan phase by target domain", () => {
    const expectations: Record<string, string> = {
      WEB_API: "ctf-web",
      WEB3: "ctf-web3",
      PWN: "ctf-pwn",
      REV: "ctf-rev",
      CRYPTO: "ctf-crypto",
      FORENSICS: "ctf-forensics",
      MISC: "ctf-explore",
      UNKNOWN: "ctf-explore",
    };

    for (const [targetType, expected] of Object.entries(expectations)) {
      const decision = route(
        makeState({
          mode: "CTF",
          phase: "SCAN",
          targetType: targetType as SessionState["targetType"],
        })
      );
      expect(decision.primary).toBe(expected);
    }
  });

  it("routes ctf execute phase by target domain", () => {
    const expectations: Record<string, string> = {
      WEB_API: "ctf-web",
      WEB3: "ctf-web3",
      PWN: "ctf-pwn",
      REV: "ctf-rev",
      CRYPTO: "ctf-crypto",
      FORENSICS: "ctf-forensics",
      MISC: "ctf-solve",
      UNKNOWN: "ctf-solve",
    };

    for (const [targetType, expected] of Object.entries(expectations)) {
      const decision = route(
        makeState({
          mode: "CTF",
          phase: "EXECUTE",
          targetType: targetType as SessionState["targetType"],
        })
      );
      expect(decision.primary).toBe(expected);
    }
  });

  it("routes bounty to bounty-research after two read-only inconclusive checks", () => {
    const decision = route(
      makeState({
        mode: "BOUNTY",
        scopeConfirmed: true,
        readonlyInconclusiveCount: 2,
      })
    );
    expect(decision.primary).toBe("bounty-research");
  });

  it("maps failover agent on matching error signatures", () => {
    const fallback = resolveFailoverAgent("explore", "context_length_exceeded happened", {
      signatures: ["context_length_exceeded", "timeout"],
      map: {
        explore: "explore-fallback",
        librarian: "librarian-fallback",
        oracle: "oracle-fallback",
      },
    });

    expect(fallback).toBe("explore-fallback");
  });
});
