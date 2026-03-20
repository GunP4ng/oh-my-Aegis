import { describe, expect, it } from "bun:test";
import { isStuck, resolveFailoverAgent, route } from "../src/orchestration/router";
import { OrchestratorConfigSchema } from "../src/config/schema";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";

function makeState(overrides: Partial<SessionState>): SessionState {
  return { ...DEFAULT_STATE, ...overrides, lastUpdatedAt: 0 };
}

type GovernanceOverrides = {
  patch?: Partial<SessionState["governance"]["patch"]>;
  review?: Partial<SessionState["governance"]["review"]>;
  council?: Partial<SessionState["governance"]["council"]>;
  applyLock?: Partial<SessionState["governance"]["applyLock"]>;
};

function makeGovernance(overrides: GovernanceOverrides): SessionState["governance"] {
  return {
    ...DEFAULT_STATE.governance,
    ...overrides,
    patch: {
      ...DEFAULT_STATE.governance.patch,
      ...(overrides.patch ?? {}),
    },
    review: {
      ...DEFAULT_STATE.governance.review,
      ...(overrides.review ?? {}),
    },
    council: {
      ...DEFAULT_STATE.governance.council,
      ...(overrides.council ?? {}),
    },
    applyLock: {
      ...DEFAULT_STATE.governance.applyLock,
      ...(overrides.applyLock ?? {}),
    },
  };
}

describe("router", () => {
  it("routes bounty sessions without scope to bounty-scope", () => {
    const decision = route(makeState({ mode: "BOUNTY", scopeConfirmed: false }));
    expect(decision.primary).toBe("bounty-scope");
  });

  it("keeps low-risk sessions on normal route without council gate delay", () => {
    const digest = "sha256:abc";
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "SCAN",
        targetType: "WEB_API",
        governance: makeGovernance({
          patch: {
            digest,
            authorProviderFamily: "openai",
            reviewerProviderFamily: "anthropic",
            proposalRefs: ["proposal:files=1 loc=42 critical_paths_touched=0 risk_score=20"],
          },
          review: {
            verdict: "approved",
            digest,
            reviewedAt: 1700000000000,
          },
        }),
      })
    );
    expect(decision.primary).toBe("ctf-web");
    expect(decision.council).toBeUndefined();
  });

  it("blocks high-risk patch context when council decision artifact is missing", () => {
    const digest = "sha256:highrisk";
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "REV",
        governance: makeGovernance({
          patch: {
            digest,
            authorProviderFamily: "openai",
            reviewerProviderFamily: "anthropic",
            proposalRefs: ["proposal:files=9 loc=1200 critical_paths_touched=2 risk_score=92"],
          },
          review: {
            verdict: "approved",
            digest,
            reviewedAt: 1700000000000,
          },
        }),
      })
    );
    expect(decision.primary).toBe("aegis-plan--governance-council-required");
    expect(decision.reason).toBe(
      "Governance gate blocked: council-required (governance_council_required_missing_artifact)."
    );
    expect(decision.council?.outcome).toBe("required_missing");
  });

  it("unblocks council-required route when decision artifact is recorded", () => {
    const digest = "sha256:highrisk";
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "SCAN",
        targetType: "WEB_API",
        governance: makeGovernance({
          patch: {
            digest,
            authorProviderFamily: "openai",
            reviewerProviderFamily: "anthropic",
            proposalRefs: ["proposal:files=8 loc=900 critical_paths_touched=1 risk_score=80"],
          },
          review: {
            verdict: "approved",
            digest,
            reviewedAt: 1700000000000,
          },
          council: {
            decisionArtifactRef: ".Aegis/runs/run-1/council/decision.json",
            decidedAt: 1700000000000,
          },
        }),
      })
    );
    expect(decision.primary).toBe("ctf-web");
  });

  it("returns deterministic review-required governance block reason", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "REV",
        governance: makeGovernance({
          patch: {
            digest: "sha256:review-needed",
            proposalRefs: ["proposal:files=2 loc=80 critical_paths_touched=0 risk_score=15"],
          },
        }),
      })
    );

    expect(decision.primary).toBe("aegis-plan--governance-review-required");
    expect(decision.reason).toBe(
      "Governance gate blocked: review-required (governance_review_not_approved:pending)."
    );
  });

  it("pins apply-ready governance route in execute phase when gates are satisfied", () => {
    const digest = "sha256:ready";
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "WEB_API",
        governance: makeGovernance({
          patch: {
            digest,
            authorProviderFamily: "openai",
            reviewerProviderFamily: "anthropic",
            proposalRefs: ["proposal:files=1 loc=20 critical_paths_touched=0 risk_score=10"],
          },
          review: {
            verdict: "approved",
            digest,
            reviewedAt: 1700000000000,
          },
        }),
      })
    );

    expect(decision.primary).toBe("aegis-exec--governance-apply-ready");
    expect(decision.reason).toBe(
      "Governance gate satisfied: apply-ready route pinned for guarded execution."
    );
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

  it("returns md-scribe route for CLOSED phase sessions", () => {
    const decision = route(makeState({ mode: "CTF", phase: "CLOSED" }));
    expect(decision.primary).toBe("md-scribe");
    expect(decision.reason).toContain("CLOSED");
  });

  it("lane ownership: md-scribe primary demoted when activeSolveLane is set", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "REV",
        contextFailCount: 1,
        activeSolveLane: "ctf-rev",
        lastFailureReason: "context_overflow",
      })
    );
    // context_overflow at EXECUTE → stuck route primary, not md-scribe, so lane logic won't fire here
    // Use a scenario where md-scribe would be primary: context fail in non-EXECUTE phase
    const decision2 = route(
      makeState({
        mode: "CTF",
        phase: "VERIFY",
        targetType: "REV",
        contextFailCount: 2,
        activeSolveLane: "ctf-rev",
        lastFailureReason: "context_overflow",
        mdScribePrimaryStreak: 0,
      })
    );
    expect(decision2.primary).toBe("ctf-rev");
    expect(decision2.followups).toContain("md-scribe");
  });

  it("lane ownership: allows md-scribe when contextFailCount >= 3", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "VERIFY",
        targetType: "REV",
        contextFailCount: 3,
        activeSolveLane: "ctf-rev",
        lastFailureReason: "context_overflow",
        mdScribePrimaryStreak: 0,
      })
    );
    expect(decision.primary).toBe("md-scribe");
  });

  it("circuit breaker: stale tool pattern >= 3 in EXECUTE routes to stuck route", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "REV",
        staleToolPatternLoops: 3,
        lastToolPattern: "ctf-rev:static_analysis",
      })
    );
    expect(decision.primary).toBe("aegis-deep");
    expect(decision.reason).toContain("circuit_breaker");
    expect(decision.reason).toContain("stale_tool_pattern");
  });

  it("circuit breaker: stale tool pattern < 3 does NOT trigger in EXECUTE", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "REV",
        staleToolPatternLoops: 2,
        lastToolPattern: "ctf-rev:static_analysis",
      })
    );
    expect(decision.reason).not.toContain("circuit_breaker");
  });

  it("circuit breaker: stale tool pattern >= 3 does NOT trigger outside EXECUTE phase", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "PLAN",
        targetType: "REV",
        staleToolPatternLoops: 5,
        lastToolPattern: "ctf-rev:static_analysis",
      })
    );
    expect(decision.reason).not.toContain("circuit_breaker");
  });

  it("loop guard: active block within 5 min routes to stuck route", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "WEB_API",
        loopGuard: {
          recentActionSignatures: [],
          blockedActionSignature: "some_action_sig",
          blockedReason: "repeated_identical_action",
          blockedAt: Date.now() - 60_000, // 1 min ago, within 5 min window
        },
      })
    );
    expect(decision.primary).toBe("ctf-research");
    expect(decision.reason).toContain("loop_guard_active");
  });

  it("loop guard: expired block (>5 min) does NOT trigger stuck route", () => {
    const decision = route(
      makeState({
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "WEB_API",
        loopGuard: {
          recentActionSignatures: [],
          blockedActionSignature: "some_action_sig",
          blockedReason: "repeated_identical_action",
          blockedAt: Date.now() - 6 * 60_000, // 6 min ago, outside 5 min window
        },
      })
    );
    expect(decision.reason).not.toContain("loop_guard_active");
  });
});
