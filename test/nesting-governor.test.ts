import { describe, expect, it } from "bun:test";
import { decideNestingEscalation } from "../src/orchestration/nesting-governor";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    ...DEFAULT_STATE,
    alternatives: [...DEFAULT_STATE.alternatives],
    contradictionArtifacts: [...DEFAULT_STATE.contradictionArtifacts],
    replayLowTrustBinaries: [...DEFAULT_STATE.replayLowTrustBinaries],
    toolCallHistory: [...DEFAULT_STATE.toolCallHistory],
    recentEvents: [...DEFAULT_STATE.recentEvents],
    governance: structuredClone(DEFAULT_STATE.governance),
    failureReasonCounts: { ...DEFAULT_STATE.failureReasonCounts },
    dispatchHealthBySubagent: {},
    subagentProfileOverrides: {},
    modelHealthByModel: {},
    todoRuntime: structuredClone(DEFAULT_STATE.todoRuntime),
    loopGuard: structuredClone(DEFAULT_STATE.loopGuard),
    sharedChannels: {},
    ...overrides,
  };
}

describe("nesting-governor", () => {
  it("counts orchestration-tier hops only", () => {
    const state = makeState({ orchestrationHopStreak: 2 });

    const domainWorkerDecision = decideNestingEscalation({
      state,
      callerAgent: "aegis-exec",
      targetSubagent: "ctf-pwn",
      maxFailoverRetries: 2,
    });

    expect(domainWorkerDecision.targetIsOrchestrationTier).toBe(false);
    expect(domainWorkerDecision.nextOrchestrationHopStreak).toBe(0);
    expect(domainWorkerDecision.action).toBe("allow");

    const orchestrationDecision = decideNestingEscalation({
      state,
      callerAgent: "aegis-exec",
      targetSubagent: "aegis-deep",
      maxFailoverRetries: 2,
    });

    expect(orchestrationDecision.targetIsOrchestrationTier).toBe(true);
    expect(orchestrationDecision.nextOrchestrationHopStreak).toBe(3);
  });

  it("returns bubble_up for blocked worker recursion", () => {
    const state = makeState({
      noNewEvidenceLoops: 2,
      orchestrationHopStreak: 1,
    });

    const decision = decideNestingEscalation({
      state,
      callerAgent: "aegis-exec",
      targetSubagent: "aegis-deep",
      maxFailoverRetries: 2,
    });

    expect(decision.blocked).toBe(true);
    expect(decision.action).toBe("bubble_up");
    expect(decision.nextEscalationLevel).toBe(1);
  });

  it("returns bubble_up for first blocked manager attempt before rung-1 state exists", () => {
    const state = makeState({
      noNewEvidenceLoops: 2,
    });

    const decision = decideNestingEscalation({
      state,
      callerAgent: "aegis",
      targetSubagent: "aegis-deep",
      maxFailoverRetries: 2,
    });

    expect(decision.blocked).toBe(true);
    expect(decision.action).toBe("bubble_up");
    expect(decision.nextEscalationLevel).toBe(1);
  });

  it("returns advisory_plan for blocked manager epoch after rung-1 bubble-up state", () => {
    const state = makeState({
      blockedEpochId: "epoch-1",
      blockedEpochActive: true,
      blockedEpochEscalationLevel: 1,
      noNewEvidenceLoops: 2,
    });

    const decision = decideNestingEscalation({
      state,
      callerAgent: "aegis",
      targetSubagent: "aegis-deep",
      maxFailoverRetries: 2,
    });

    expect(decision.blocked).toBe(true);
    expect(decision.action).toBe("advisory_plan");
    expect(decision.nextEscalationLevel).toBe(2);
  });

  it("returns blocked_summary after advisory", () => {
    const state = makeState({
      blockedEpochId: "epoch-1",
      blockedEpochActive: true,
      blockedEpochEscalationLevel: 2,
      blockedEpochSummaryIssued: false,
      noNewEvidenceLoops: 2,
    });

    const decision = decideNestingEscalation({
      state,
      callerAgent: "aegis",
      targetSubagent: "aegis-deep",
      maxFailoverRetries: 2,
    });

    expect(decision.blocked).toBe(true);
    expect(decision.action).toBe("blocked_summary");
    expect(decision.nextEscalationLevel).toBe(3);
  });
});
