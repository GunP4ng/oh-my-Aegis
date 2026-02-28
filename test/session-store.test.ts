import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function loadFixture(name: string): string {
  return readFileSync(join(import.meta.dir, "fixtures", "session-store", name), "utf-8");
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
    expect(state.phase).toBe("VERIFY");
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

  it("moves through VERIFY and SUBMIT phases with candidate level progression", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s3b", "CTF");
    store.applyEvent("s3b", "scan_completed");
    store.applyEvent("s3b", "plan_completed");
    store.applyEvent("s3b", "candidate_found");

    let state = store.get("s3b");
    expect(state.phase).toBe("VERIFY");
    expect(state.candidateLevel).toBe("L1");

    store.applyEvent("s3b", "verify_success");
    state = store.get("s3b");
    expect(state.phase).toBe("SUBMIT");
    expect(state.submissionPending).toBe(true);
    expect(state.candidateLevel).toBe("L2");

    store.setVerified("s3b", "flag{accepted}");
    store.setAcceptanceEvidence("s3b", "Accepted by checker");
    store.applyEvent("s3b", "submit_accepted");
    state = store.get("s3b");
    expect(state.submissionAccepted).toBe(true);
    expect(state.candidateLevel).toBe("L3");
    expect(state.latestVerified).toBe("flag{accepted}");
  });

  it("setCandidateLevel is monotonic and does not downgrade", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s3c", "CTF");

    store.setCandidateLevel("s3c", "L2");
    expect(store.get("s3c").candidateLevel).toBe("L2");

    store.setCandidateLevel("s3c", "L1");
    expect(store.get("s3c").candidateLevel).toBe("L2");

    store.setCandidateLevel("s3c", "L3");
    expect(store.get("s3c").candidateLevel).toBe("L3");

    store.setCandidateLevel("s3c", "L0");
    expect(store.get("s3c").candidateLevel).toBe("L3");
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

  it("keeps contradiction lock active until artifact evidence is recorded", () => {
    const store = new SessionStore(makeRoot());
    store.applyEvent("s10", "static_dynamic_contradiction");

    let state = store.get("s10");
    expect(state.contradictionPivotDebt).toBe(2);
    expect(state.contradictionPatchDumpDone).toBe(false);
    expect(state.contradictionArtifactLockActive).toBe(true);

    store.setLastDispatch("s10", "ctf-rev", "ctf-rev");
    state = store.get("s10");
    expect(state.contradictionPivotDebt).toBe(1);
    expect(state.contradictionPatchDumpDone).toBe(false);
    expect(state.contradictionArtifactLockActive).toBe(true);

    store.recordContradictionArtifacts("s10", [".Aegis/artifacts/tool-output/s10/extract.json"]);
    state = store.get("s10");
    expect(state.contradictionPivotDebt).toBe(0);
    expect(state.contradictionPatchDumpDone).toBe(true);
    expect(state.contradictionArtifactLockActive).toBe(false);
    expect(state.contradictionArtifacts).toEqual([
      ".Aegis/artifacts/tool-output/s10/extract.json",
    ]);
  });

  it("does not release contradiction lock from bounty dispatch alone", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s11", "BOUNTY");
    store.applyEvent("s11", "static_dynamic_contradiction");

    let state = store.get("s11");
    expect(state.contradictionPivotDebt).toBe(2);
    expect(state.contradictionPatchDumpDone).toBe(false);
    expect(state.contradictionArtifactLockActive).toBe(true);

    store.setLastDispatch("s11", "bounty-triage", "bounty-triage");
    state = store.get("s11");
    expect(state.contradictionPatchDumpDone).toBe(false);
    expect(state.contradictionArtifactLockActive).toBe(true);

    store.recordContradictionArtifacts("s11", [".Aegis/artifacts/tool-output/s11/trace.log"]);
    state = store.get("s11");
    expect(state.contradictionPatchDumpDone).toBe(true);
    expect(state.contradictionArtifactLockActive).toBe(false);
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
    expect(state.contradictionArtifactLockActive).toBe(false);
    expect(state.contradictionArtifacts).toEqual([]);
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

  it("migrates v1 map fixture and next persist writes v2 envelope", () => {
    const root = makeRoot();
    const statePath = join(root, ".Aegis", "orchestrator_state.json");
    mkdirSync(join(root, ".Aegis"), { recursive: true });
    writeFileSync(statePath, loadFixture("v1-map.json"), "utf-8");

    const store = new SessionStore(root);
    const loaded = store.get("fixture-v1");
    expect(loaded.mode).toBe("CTF");
    expect(loaded.phase).toBe("EXECUTE");
    expect(loaded.latestCandidate).toBe("flag{legacy-candidate}");

    store.setMode("fixture-v1", "BOUNTY");

    const persisted = JSON.parse(readFileSync(statePath, "utf-8")) as {
      schemaVersion: number;
      sessions: Record<string, { mode: string }>;
    };
    expect(persisted.schemaVersion).toBe(2);
    expect(persisted.sessions["fixture-v1"]?.mode).toBe("BOUNTY");
  });

  it("loads v2 envelope fixture without data loss", () => {
    const root = makeRoot();
    const statePath = join(root, ".Aegis", "orchestrator_state.json");
    mkdirSync(join(root, ".Aegis"), { recursive: true });
    writeFileSync(statePath, loadFixture("v2-envelope.json"), "utf-8");

    const store = new SessionStore(root);
    const loaded = store.get("fixture-v2");

    expect(loaded.mode).toBe("BOUNTY");
    expect(loaded.phase).toBe("PLAN");
    expect(loaded.lastTaskRoute).toBe("bounty-triage");
    expect(loaded.latestVerified).toBe("flag{verified-v2}");
    expect(loaded.contradictionArtifacts).toEqual([".Aegis/artifacts/tool-output/v2/trace.log"]);
  });

  it("ignores future schema fixture and never overwrites file", () => {
    const root = makeRoot();
    const statePath = join(root, ".Aegis", "orchestrator_state.json");
    mkdirSync(join(root, ".Aegis"), { recursive: true });
    writeFileSync(statePath, loadFixture("v3-future.json"), "utf-8");
    const before = readFileSync(statePath, "utf-8");

    const store = new SessionStore(root);
    const fresh = store.get("new-session");
    expect(fresh.latestCandidate).toBe("");
    expect(fresh.phase).toBe("SCAN");

    store.setMode("new-session", "CTF");
    const after = readFileSync(statePath, "utf-8");
    expect(after).toBe(before);
    expect(store.get("new-session").mode).toBe("CTF");
  });

  it("restores contradiction artifact lock for legacy in-progress contradiction state", () => {
    const root = makeRoot();
    const legacyPath = join(root, ".Aegis", "orchestrator_state.json");
    mkdirSync(join(root, ".Aegis"), { recursive: true });
    const legacy = {
      s7lock: {
        mode: "CTF",
        phase: "EXECUTE",
        targetType: "REV",
        scopeConfirmed: true,
        candidatePendingVerification: false,
        latestCandidate: "flag{candidate}",
        latestVerified: "",
        hypothesis: "",
        alternatives: [],
        noNewEvidenceLoops: 0,
        samePayloadLoops: 0,
        staleToolPatternLoops: 0,
        lastToolPattern: "",
        contradictionPivotDebt: 2,
        contradictionPatchDumpDone: false,
        contradictionArtifacts: [],
        mdScribePrimaryStreak: 0,
        verifyFailCount: 0,
        readonlyInconclusiveCount: 0,
        contextFailCount: 0,
        timeoutFailCount: 0,
        recentEvents: ["static_dynamic_contradiction"],
        lastTaskCategory: "",
        pendingTaskFailover: false,
        taskFailoverCount: 0,
        lastFailureReason: "static_dynamic_contradiction",
        lastFailureSummary: "",
        lastFailedRoute: "ctf-rev",
        lastFailureAt: 1,
        failureReasonCounts: {
          none: 0,
          verification_mismatch: 0,
          tooling_timeout: 0,
          context_overflow: 0,
          hypothesis_stall: 0,
          unsat_claim: 0,
          static_dynamic_contradiction: 1,
          exploit_chain: 0,
          environment: 0,
        },
        lastUpdatedAt: 1,
      },
    };

    writeFileSync(legacyPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf-8");
    const reloaded = new SessionStore(root);
    const state = reloaded.get("s7lock");

    expect(state.contradictionPivotDebt).toBe(2);
    expect(state.contradictionPatchDumpDone).toBe(false);
    expect(state.contradictionArtifactLockActive).toBe(true);
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

  it("applyEvent contradiction_sla_dump_done clears SLA requirements and lock/debt", () => {
    const store = new SessionStore(makeRoot());
    store.update("s13", {
      contradictionPatchDumpDone: false,
      contradictionSLADumpRequired: true,
      contradictionArtifactLockActive: true,
      contradictionPivotDebt: 2,
    });

    store.applyEvent("s13", "contradiction_sla_dump_done");
    const state = store.get("s13");

    expect(state.contradictionPatchDumpDone).toBe(true);
    expect(state.contradictionSLADumpRequired).toBe(false);
    expect(state.contradictionArtifactLockActive).toBe(false);
    expect(state.contradictionPivotDebt).toBe(0);
  });

  it("applyEvent unsat_unhooked_oracle sets unsatUnhookedOracleRun true", () => {
    const store = new SessionStore(makeRoot());
    expect(store.get("s14").unsatUnhookedOracleRun).toBe(false);

    store.applyEvent("s14", "unsat_unhooked_oracle");
    const state = store.get("s14");

    expect(state.unsatUnhookedOracleRun).toBe(true);
  });

  it("applyEvent oracle_progress only updates oracleProgressUpdatedAt", async () => {
    const store = new SessionStore(makeRoot());
    store.update("s15", {
      oraclePassCount: 4,
      oracleFailIndex: 2,
      oracleTotalTests: 8,
      oracleProgressUpdatedAt: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 2));
    store.applyEvent("s15", "oracle_progress");
    const state = store.get("s15");

    expect(state.oraclePassCount).toBe(4);
    expect(state.oracleFailIndex).toBe(2);
    expect(state.oracleTotalTests).toBe(8);
    expect(state.oracleProgressUpdatedAt).toBeGreaterThan(0);
  });
});
