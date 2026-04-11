import { describe, expect, it } from "bun:test";
import { applySessionEvent } from "../src/state/session-event-reducer";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";

function makeBlockedEpochState(overrides: Partial<SessionState> = {}): SessionState {
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
    blockedEpochId: "epoch-1",
    blockedEpochActive: true,
    blockedEpochEscalationLevel: 1,
    blockedEpochStartedAt: 100,
    blockedEpochLastProgressAt: 200,
    blockedEpochSummaryIssued: true,
    blockedEpochReason: "loop_guard_active",
    orchestrationHopStreak: 4,
    ...overrides,
  };
}

const deps = {
  now: () => 1234,
  computeCandidateHash: () => "new-hash",
};

describe("session-event-reducer blocked epoch", () => {
  it("new_evidence clears blocked epoch", () => {
    const state = makeBlockedEpochState({
      latestCandidate: "flag{candidate}",
      lastCandidateHash: "old-hash",
      phase: "VERIFY",
    });

    applySessionEvent(state, "new_evidence", deps);

    expect(state.blockedEpochId).toBe("");
    expect(state.blockedEpochActive).toBe(false);
    expect(state.blockedEpochEscalationLevel).toBe(0);
    expect(state.blockedEpochStartedAt).toBe(0);
    expect(state.blockedEpochLastProgressAt).toBe(0);
    expect(state.blockedEpochSummaryIssued).toBe(false);
    expect(state.blockedEpochReason).toBe("");
    expect(state.orchestrationHopStreak).toBe(0);
  });

  it("verify_success clears blocked epoch", () => {
    const state = makeBlockedEpochState();

    applySessionEvent(state, "verify_success", deps);

    expect(state.blockedEpochId).toBe("");
    expect(state.blockedEpochActive).toBe(false);
    expect(state.blockedEpochEscalationLevel).toBe(0);
    expect(state.blockedEpochStartedAt).toBe(0);
    expect(state.blockedEpochLastProgressAt).toBe(0);
    expect(state.blockedEpochSummaryIssued).toBe(false);
    expect(state.blockedEpochReason).toBe("");
    expect(state.orchestrationHopStreak).toBe(0);
  });

  it("submit_accepted clears blocked epoch", () => {
    const state = makeBlockedEpochState();

    applySessionEvent(state, "submit_accepted", deps);

    expect(state.blockedEpochActive).toBe(false);
    expect(state.blockedEpochReason).toBe("");
    expect(state.orchestrationHopStreak).toBe(0);
  });

  it("scope_confirmed clears blocked epoch", () => {
    const state = makeBlockedEpochState();

    applySessionEvent(state, "scope_confirmed", deps);

    expect(state.blockedEpochActive).toBe(false);
    expect(state.blockedEpochReason).toBe("");
    expect(state.orchestrationHopStreak).toBe(0);
  });

  it("contradiction_sla_dump_done clears blocked epoch", () => {
    const state = makeBlockedEpochState();

    applySessionEvent(state, "contradiction_sla_dump_done", deps);

    expect(state.blockedEpochActive).toBe(false);
    expect(state.blockedEpochReason).toBe("");
    expect(state.orchestrationHopStreak).toBe(0);
  });

  it("reset_loop preserves blocked epoch", () => {
    const state = makeBlockedEpochState();

    applySessionEvent(state, "reset_loop", deps);

    expect(state.blockedEpochId).toBe("epoch-1");
    expect(state.blockedEpochActive).toBe(true);
    expect(state.blockedEpochEscalationLevel).toBe(1);
    expect(state.blockedEpochStartedAt).toBe(100);
    expect(state.blockedEpochLastProgressAt).toBe(200);
    expect(state.blockedEpochSummaryIssued).toBe(true);
    expect(state.blockedEpochReason).toBe("loop_guard_active");
    expect(state.orchestrationHopStreak).toBe(4);
  });
});
