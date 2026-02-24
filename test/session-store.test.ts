import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/state/session-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function makeRoot(): string {
  const root = join(tmpdir(), `ctf-orch-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  return root;
}

describe("session-store", () => {
  it("persists mode and state events", () => {
    const root = makeRoot();
    const store = new SessionStore(root);

    store.setMode("s1", "CTF");
    store.applyEvent("s1", "scan_completed");
    store.setCandidate("s1", "flag{candidate}");

    const reloaded = new SessionStore(root);
    const state = reloaded.get("s1");

    expect(state.mode).toBe("CTF");
    expect(state.phase).toBe("PLAN");
    expect(state.latestCandidate).toBe("flag{candidate}");
    expect(state.candidatePendingVerification).toBe(true);
    expect(state.latestVerified).toBe("");
  });

  it("separates candidate and verified values", () => {
    const store = new SessionStore(makeRoot());
    store.setCandidate("s3", "flag{candidate}");
    store.setVerified("s3", "flag{verified}");
    store.applyEvent("s3", "verify_success");

    const state = store.get("s3");
    expect(state.latestCandidate).toBe("flag{candidate}");
    expect(state.latestVerified).toBe("flag{verified}");
    expect(state.candidatePendingVerification).toBe(false);
  });

  it("resets loop counters on new evidence", () => {
    const store = new SessionStore(makeRoot());
    store.applyEvent("s2", "no_new_evidence");
    store.applyEvent("s2", "same_payload_repeat");
    store.applyEvent("s2", "new_evidence");

    const state = store.get("s2");
    expect(state.noNewEvidenceLoops).toBe(0);
    expect(state.samePayloadLoops).toBe(0);
  });

  it("tracks task failover state transitions", () => {
    const store = new SessionStore(makeRoot());
    store.triggerTaskFailover("s4");
    let state = store.get("s4");
    expect(state.pendingTaskFailover).toBe(true);

    store.consumeTaskFailover("s4");
    state = store.get("s4");
    expect(state.pendingTaskFailover).toBe(false);
    expect(state.taskFailoverCount).toBe(1);

    store.clearTaskFailover("s4");
    state = store.get("s4");
    expect(state.taskFailoverCount).toBe(0);
  });

  it("records and clears structured failure reason metadata", () => {
    const store = new SessionStore(makeRoot());
    store.recordFailure("s5", "environment", "ctf-pwn", "permission denied");

    let state = store.get("s5");
    expect(state.lastFailureReason).toBe("environment");
    expect(state.lastFailedRoute).toBe("ctf-pwn");
    expect(state.failureReasonCounts.environment).toBe(1);

    store.applyEvent("s5", "verify_success");
    state = store.get("s5");
    expect(state.lastFailureReason).toBe("none");
    expect(state.lastFailureSummary).toBe("");
  });

  it("tracks per-subagent dispatch outcomes", () => {
    const store = new SessionStore(makeRoot());
    store.setLastDispatch("s6", "ctf-web3", "ctf-web3");
    store.recordDispatchOutcome("s6", "retryable_failure");
    store.recordDispatchOutcome("s6", "hard_failure");
    store.recordDispatchOutcome("s6", "success");

    const state = store.get("s6");
    const health = state.dispatchHealthBySubagent["ctf-web3"];
    expect(health.retryableFailureCount).toBe(1);
    expect(health.hardFailureCount).toBe(1);
    expect(health.successCount).toBe(1);
    expect(health.consecutiveFailureCount).toBe(0);
    expect(state.lastTaskRoute).toBe("ctf-web3");
    expect(state.lastTaskSubagent).toBe("ctf-web3");
  });

  it("tracks stale tool-pattern loops and md-scribe primary streak", () => {
    const store = new SessionStore(makeRoot());
    store.setLastDispatch("s9", "md-scribe", "md-scribe");
    store.setLastDispatch("s9", "md-scribe", "md-scribe");
    store.setLastDispatch("s9", "ctf-rev", "ctf-rev");

    const state = store.get("s9");
    expect(state.mdScribePrimaryStreak).toBe(0);
    expect(state.lastToolPattern).toBe("ctf-rev");
    expect(state.staleToolPatternLoops).toBe(1);
  });

  it("arms contradiction pivot debt and marks patch-dump completion on ctf-rev dispatch", () => {
    const store = new SessionStore(makeRoot());
    store.applyEvent("s10", "static_dynamic_contradiction");

    let state = store.get("s10");
    expect(state.contradictionPivotDebt).toBe(2);
    expect(state.contradictionPatchDumpDone).toBe(false);

    store.setLastDispatch("s10", "ctf-rev", "ctf-rev");
    state = store.get("s10");
    expect(state.contradictionPivotDebt).toBe(1);
    expect(state.contradictionPatchDumpDone).toBe(true);
  });

  it("marks contradiction pivot completion for bounty extraction dispatch", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s11", "BOUNTY");
    store.applyEvent("s11", "static_dynamic_contradiction");

    let state = store.get("s11");
    expect(state.contradictionPivotDebt).toBe(2);
    expect(state.contradictionPatchDumpDone).toBe(false);

    store.setLastDispatch("s11", "bounty-triage", "bounty-triage");
    state = store.get("s11");
    expect(state.contradictionPatchDumpDone).toBe(true);
  });

  it("partially resets timeout/context debt on candidate/new_evidence events", () => {
    const store = new SessionStore(makeRoot());
    store.applyEvent("s12", "timeout");
    store.applyEvent("s12", "timeout");
    store.applyEvent("s12", "context_length_exceeded");

    let state = store.get("s12");
    expect(state.timeoutFailCount).toBe(2);
    expect(state.contextFailCount).toBe(1);

    store.applyEvent("s12", "candidate_found");
    state = store.get("s12");
    expect(state.timeoutFailCount).toBe(1);
    expect(state.contextFailCount).toBe(0);

    store.applyEvent("s12", "new_evidence");
    state = store.get("s12");
    expect(state.timeoutFailCount).toBe(0);
    expect(state.contextFailCount).toBe(0);
  });

  it("loads legacy persisted state without new dispatch fields", () => {
    const root = makeRoot();
    const legacyPath = join(root, ".Aegis", "orchestrator_state.json");
    mkdirSync(join(root, ".Aegis"), { recursive: true });
    const legacy = {
      s7: {
        mode: "CTF",
        phase: "SCAN",
        targetType: "UNKNOWN",
        scopeConfirmed: false,
        candidatePendingVerification: false,
        latestCandidate: "",
        latestVerified: "",
        hypothesis: "",
        alternatives: [],
        noNewEvidenceLoops: 0,
        samePayloadLoops: 0,
        staleToolPatternLoops: 0,
        lastToolPattern: "",
        contradictionPivotDebt: 0,
        contradictionPatchDumpDone: false,
        mdScribePrimaryStreak: 0,
        verifyFailCount: 0,
        readonlyInconclusiveCount: 0,
        contextFailCount: 0,
        timeoutFailCount: 0,
        recentEvents: [],
        lastTaskCategory: "",
        pendingTaskFailover: false,
        taskFailoverCount: 0,
        lastFailureReason: "none",
        lastFailureSummary: "",
        lastFailedRoute: "",
        lastFailureAt: 0,
        failureReasonCounts: {
          none: 0,
          verification_mismatch: 0,
          tooling_timeout: 0,
          context_overflow: 0,
          hypothesis_stall: 0,
          unsat_claim: 0,
          static_dynamic_contradiction: 0,
          exploit_chain: 0,
          environment: 0,
        },
        lastUpdatedAt: 1,
      },
    };

    writeFileSync(legacyPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf-8");
    const reloaded = new SessionStore(root);
    const state = reloaded.get("s7");
    expect(state.lastTaskRoute).toBe("");
    expect(state.lastTaskSubagent).toBe("");
    expect(state.lastTaskModel).toBe("");
    expect(state.lastTaskVariant).toBe("");
    expect(state.staleToolPatternLoops).toBe(0);
    expect(state.lastToolPattern).toBe("");
    expect(state.contradictionPivotDebt).toBe(0);
    expect(state.contradictionPatchDumpDone).toBe(false);
    expect(state.mdScribePrimaryStreak).toBe(0);
    expect(state.envParityRequired).toBe(false);
    expect(state.envParityRequirementReason).toBe("");
    expect(state.revVmSuspected).toBe(false);
    expect(state.revRiskScore).toBe(0);
    expect(state.revRiskSignals).toEqual([]);
    expect(state.revStaticTrust).toBe(1);
    expect(state.dispatchHealthBySubagent).toEqual({});
    expect(state.subagentProfileOverrides).toEqual({});
  });

  it("stores and clears session subagent profile overrides", () => {
    const root = makeRoot();
    const store = new SessionStore(root);

    store.setSubagentProfileOverride("s8", "ctf-web", {
      model: "google/antigravity-gemini-3-flash",
      variant: "minimal",
    });
    let state = store.get("s8");
    expect(state.subagentProfileOverrides["ctf-web"]).toEqual({
      model: "google/antigravity-gemini-3-flash",
      variant: "minimal",
    });

    const reloaded = new SessionStore(root);
    state = reloaded.get("s8");
    expect(state.subagentProfileOverrides["ctf-web"]?.model).toBe("google/antigravity-gemini-3-flash");
    expect(state.subagentProfileOverrides["ctf-web"]?.variant).toBe("minimal");

    reloaded.clearSubagentProfileOverride("s8", "ctf-web");
    state = reloaded.get("s8");
    expect(Object.prototype.hasOwnProperty.call(state.subagentProfileOverrides, "ctf-web")).toBe(false);
  });
});
