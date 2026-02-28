import { describe, expect, it } from "bun:test";
import { isStuck, resolveFailoverAgent, route } from "../src/orchestration/router";
import { OrchestratorConfigSchema } from "../src/config/schema";
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

  it("suppresses stuck detection for 10 minutes after oracle progress improvement", () => {
    const stuckState = makeState({
      mode: "CTF",
      noNewEvidenceLoops: 5,
      samePayloadLoops: 5,
      verifyFailCount: 0,
      oracleProgressImprovedAt: Date.now() - 2 * 60 * 1000,
    });
    expect(isStuck(stuckState)).toBe(false);
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

  it("routes ctf candidate through decoy-check for all targets by default", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        candidatePendingVerification: true,
        targetType: "FORENSICS",
        latestCandidate: "flag{candidate}",
      })
    );
    expect(decision.primary).toBe("ctf-decoy-check");
    expect(decision.followups).toContain("ctf-verify");
  });

  it("routes low-confidence placeholder candidate through decoy-check", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        candidatePendingVerification: true,
        targetType: "FORENSICS",
        latestCandidate: "flag{placeholder}",
      })
    );
    expect(decision.primary).toBe("ctf-decoy-check");
    expect(decision.followups).toContain("ctf-verify");
  });

  it("routes high-evidence candidate to fast verify path", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        candidatePendingVerification: true,
        targetType: "PWN",
        candidateLevel: "L3",
        latestCandidate: "flag{real_candidate}",
      })
    );
    expect(decision.primary).toBe("ctf-verify");
  });

  it("keeps low-evidence candidate on decoy-check before verify", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        candidatePendingVerification: true,
        targetType: "PWN",
        candidateLevel: "L1",
        latestCandidate: "flag{real_candidate}",
      })
    );
    expect(decision.primary).toBe("ctf-decoy-check");
    expect(decision.followups).toContain("ctf-verify");
  });

  it("keeps low-confidence candidate on decoy-check even at high evidence", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        candidatePendingVerification: true,
        targetType: "PWN",
        candidateLevel: "L3",
        latestCandidate: "flag{placeholder}",
      })
    );
    expect(decision.primary).toBe("ctf-decoy-check");
    expect(decision.followups).toContain("ctf-verify");
  });

  it("treats PWN candidate as risky and routes through decoy-check", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        candidatePendingVerification: true,
        targetType: "PWN",
        latestCandidate: "flag{candidate}",
      })
    );
    expect(decision.primary).toBe("ctf-decoy-check");
    expect(decision.followups).toContain("ctf-verify");
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

  it("routes bounty timeout failures to target-specific failover route", () => {
    const decision = route(
      makeState({
        mode: "BOUNTY",
        scopeConfirmed: true,
        targetType: "REV",
        lastFailureReason: "tooling_timeout",
      })
    );
    expect(decision.primary).toBe("bounty-scope");
  });

  it("routes static/dynamic contradiction to rev patch-and-dump first", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "REV",
        lastFailureReason: "static_dynamic_contradiction",
        contradictionPivotDebt: 2,
        contradictionPatchDumpDone: false,
        contradictionArtifactLockActive: true,
      })
    );
    expect(decision.primary).toBe("ctf-rev");
  });

  it("routes static/dynamic contradiction on non-REV CTF target to target-aware scan route", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "WEB_API",
        lastFailureReason: "static_dynamic_contradiction",
        contradictionPivotDebt: 2,
        contradictionPatchDumpDone: false,
        contradictionArtifactLockActive: true,
      })
    );
    expect(decision.primary).toBe("ctf-web");
  });

  it("adds playbook_rule marker in decoy route reason when playbook route is applied", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "WEB_API",
        decoySuspect: true,
        decoySuspectReason: "oracle failed",
      })
    );
    expect(decision.primary).toBe("ctf-web");
    expect(decision.reason).toContain("playbook_rule=");
  });

  it("adds playbook_rule marker in contradiction lock reason when playbook route is applied", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "WEB_API",
        contradictionArtifactLockActive: true,
        contradictionPatchDumpDone: false,
        contradictionPivotDebt: 1,
      })
    );
    expect(decision.primary).toBe("ctf-web");
    expect(decision.reason).toContain("playbook_rule=");
  });

  it("forces ctf-rev when contradiction pivot budget is overdue", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "REV",
        lastFailureReason: "static_dynamic_contradiction",
        contradictionPivotDebt: 0,
        contradictionPatchDumpDone: false,
        contradictionArtifactLockActive: true,
      })
    );
    expect(decision.primary).toBe("ctf-rev");
  });

  it("keeps contradiction artifact lock route even when failure reason changed", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "REV",
        lastFailureReason: "tooling_timeout",
        contradictionPivotDebt: 0,
        contradictionPatchDumpDone: false,
        contradictionArtifactLockActive: true,
      })
    );
    expect(decision.primary).toBe("ctf-rev");
  });

  it("blocks unsat conclusion without alternatives/evidence and pivots to hypothesis", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "REV",
        lastFailureReason: "unsat_claim",
      })
    );
    expect(decision.primary).toBe("ctf-hypothesis");
  });

  it("allows unsat pivot when alternatives and evidence exist", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "REV",
        lastFailureReason: "unsat_claim",
        alternatives: ["hypothesis a", "hypothesis b"],
        verifyFailCount: 1,
        unsatCrossValidationCount: 2,
        unsatUnhookedOracleRun: true,
        unsatArtifactDigestVerified: true,
      })
    );
    expect(decision.primary).toBe("aegis-deep");
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

  it("keeps execute route primary and demotes md-scribe to followup on timeout/context debt", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "WEB_API",
        contextFailCount: 2,
      })
    );
    expect(decision.primary).toBe("ctf-research");
    expect(decision.followups).toContain("md-scribe");
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
      WEB_API: "aegis-exec",
      WEB3: "aegis-exec",
      PWN: "aegis-exec",
      REV: "aegis-exec",
      CRYPTO: "aegis-exec",
      FORENSICS: "aegis-exec",
      MISC: "aegis-exec",
      UNKNOWN: "aegis-exec",
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

  it("keeps CTF in submit gate until acceptance is recorded", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "SUBMIT",
        targetType: "REV",
        submissionPending: true,
        submissionAccepted: false,
      })
    );
    expect(decision.primary).toBe("aegis-exec");
    expect(decision.reason.includes("SUBMIT gate active")).toBe(true);
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

  it("routes stuck bounty REV to target-specific stuck route", () => {
    const decision = route(
      makeState({
        mode: "BOUNTY",
        scopeConfirmed: true,
        targetType: "REV",
        noNewEvidenceLoops: 2,
      })
    );
    expect(decision.primary).toBe("bounty-triage");
  });

  it("routes static/dynamic contradiction in bounty to bounty scan route", () => {
    const decision = route(
      makeState({
        mode: "BOUNTY",
        scopeConfirmed: true,
        targetType: "REV",
        lastFailureReason: "static_dynamic_contradiction",
        contradictionPivotDebt: 2,
        contradictionPatchDumpDone: false,
      })
    );
    expect(decision.primary).toBe("bounty-triage");
  });

  it("respects config.stuck_threshold for stuck routing", () => {
    const state = makeState({
      mode: "CTF",
      phase: "SCAN",
      targetType: "WEB_API",
      noNewEvidenceLoops: 1,
    });

    expect(route(state).primary).toBe("ctf-web");

    const config = OrchestratorConfigSchema.parse({ stuck_threshold: 1 });
    expect(route(state, config).primary).toBe("ctf-research");
  });

  it("applies stale hypothesis kill-switch for repeated same pattern with no evidence", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "REV",
        lastFailureReason: "hypothesis_stall",
        staleToolPatternLoops: 3,
        noNewEvidenceLoops: 2,
      })
    );
    expect(decision.primary).toBe("ctf-hypothesis");
  });

  it("applies stale hypothesis kill-switch in bounty via stuck route", () => {
    const decision = route(
      makeState({
        mode: "BOUNTY",
        scopeConfirmed: true,
        targetType: "WEB_API",
        lastFailureReason: "hypothesis_stall",
        staleToolPatternLoops: 3,
        noNewEvidenceLoops: 2,
      })
    );
    expect(decision.primary).toBe("bounty-research");
  });

  it("blocks bounty UNSAT claim without alternatives/evidence and returns to triage", () => {
    const decision = route(
      makeState({
        mode: "BOUNTY",
        scopeConfirmed: true,
        targetType: "WEB_API",
        lastFailureReason: "unsat_claim",
      })
    );
    expect(decision.primary).toBe("bounty-triage");
  });

  it("allows bounty UNSAT pivot when alternatives/evidence are present", () => {
    const decision = route(
      makeState({
        mode: "BOUNTY",
        scopeConfirmed: true,
        targetType: "WEB_API",
        lastFailureReason: "unsat_claim",
        alternatives: ["a", "b"],
        readonlyInconclusiveCount: 1,
        unsatCrossValidationCount: 2,
        unsatUnhookedOracleRun: true,
        unsatArtifactDigestVerified: true,
      })
    );
    expect(decision.primary).toBe("bounty-research");
  });

  it("blocks repeated md-scribe as primary route and pivots to stuck route", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        targetType: "WEB_API",
        contextFailCount: 2,
        mdScribePrimaryStreak: 2,
      })
    );
    expect(decision.primary).toBe("ctf-research");
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
