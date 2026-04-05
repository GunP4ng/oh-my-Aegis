import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/state/session-store";
import { DEFAULT_STATE } from "../src/state/types";

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

  it("stages and commits canonical todo runtime", () => {
    const store = new SessionStore(makeRoot());
    store.stageTodoRuntime("s-todo", "call-1", [
      {
        id: "todo-1",
        content: "Keep current step active",
        status: "in_progress",
        priority: "high",
        resolution: "none",
      },
    ]);

    let state = store.get("s-todo");
    expect(state.todoRuntime.staged?.toolCallID).toBe("call-1");
    expect(state.todoRuntime.canonical).toEqual([]);

    store.commitTodoRuntime("s-todo", "call-1");
    state = store.get("s-todo");
    expect(state.todoRuntime.version).toBe(1);
    expect(state.todoRuntime.staged).toBeNull();
    expect(state.todoRuntime.canonical).toEqual([
      {
        id: "todo-1",
        content: "Keep current step active",
        status: "in_progress",
        priority: "high",
        resolution: "none",
      },
    ]);
  });

  it("tracks loop-guard signatures and clears active block", () => {
    const store = new SessionStore(makeRoot());
    store.recordActionSignature("s-loop", "task:repeat-1", 3);
    store.recordActionSignature("s-loop", "task:repeat-2", 3);
    store.recordActionSignature("s-loop", "task:repeat-3", 3);
    store.recordActionSignature("s-loop", "task:repeat-4", 3);
    store.setLoopGuardBlock("s-loop", "task:repeat-4", "break loop");

    let state = store.get("s-loop");
    expect(state.loopGuard.recentActionSignatures).toEqual([
      "task:repeat-2",
      "task:repeat-3",
      "task:repeat-4",
    ]);
    expect(state.loopGuard.blockedActionSignature).toBe("task:repeat-4");
    expect(state.loopGuard.blockedReason).toBe("break loop");

    store.clearLoopGuard("s-loop");
    state = store.get("s-loop");
    expect(state.loopGuard.blockedActionSignature).toBe("");
    expect(state.loopGuard.blockedReason).toBe("");
    expect(state.loopGuard.blockedAt).toBe(0);
  });

  it("publishes and reads shared channel messages in sequence order", () => {
    const store = new SessionStore(makeRoot());
    const first = store.publishSharedMessage("s-channel", "shared", {
      id: "msg-1",
      from: "ctf-web",
      to: "all",
      kind: "finding",
      summary: "Found candidate endpoint",
      refs: ["src/routes.ts:10"],
    });
    const second = store.publishSharedMessage("s-channel", "shared", {
      id: "msg-2",
      from: "ctf-research",
      to: "ctf-web",
      kind: "note",
      summary: "Header bypass looks promising",
      refs: [],
    });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(store.readSharedMessages("s-channel", "shared", 1, 20)).toEqual([second]);

    const reloaded = new SessionStore(roots[roots.length - 1]!);
    const messages = reloaded.readSharedMessages("s-channel", "shared", 0, 20);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.summary).toBe("Found candidate endpoint");
    expect(messages[1]?.summary).toBe("Header bypass looks promising");
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

  it("records input validation failure reason counts", () => {
    const store = new SessionStore(makeRoot());
    store.recordFailure("s5b", "input_validation_non_retryable", "ctf-web", "invalid_request_error");

    const state = store.get("s5b");
    expect(state.lastFailureReason).toBe("input_validation_non_retryable");
    expect(state.failureReasonCounts.input_validation_non_retryable).toBe(1);
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

  it("tracks md-scribe primary streak without stale pattern increments", () => {
    const store = new SessionStore(makeRoot());
    store.setLastDispatch("s9", "md-scribe", "md-scribe");
    store.setLastDispatch("s9", "md-scribe", "md-scribe");
    store.setLastDispatch("s9", "ctf-rev", "ctf-rev");

    const state = store.get("s9");
    expect(state.mdScribePrimaryStreak).toBe(0);
    expect(state.lastToolPattern).toBe("");
    expect(state.staleToolPatternLoops).toBe(0);
  });

  it("loads persisted input validation failure counts from disk", () => {
    const root = makeRoot();
    mkdirSync(join(root, ".Aegis"), { recursive: true });
    writeFileSync(join(root, ".Aegis", "orchestrator_state.json"), loadFixture("v4-input-validation.json"), "utf-8");

    const store = new SessionStore(root);
    const state = store.get("default");

    expect(state.lastFailureReason).toBe("input_validation_non_retryable");
    expect(state.failureReasonCounts.input_validation_non_retryable).toBe(1);
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
    expect(state.governance.patch.proposalRefs).toEqual([]);
    expect(state.governance.patch.digest).toBe("");
    expect(state.governance.review.verdict).toBe("pending");
    expect(state.governance.council.decisionArtifactRef).toBe("");
    expect(state.governance.applyLock.ownerSessionID).toBe("");
  });

  it("persists and reloads bounded governance metadata", () => {
    const root = makeRoot();
    const store = new SessionStore(root);
    store.update("s-governance", {
      governance: {
        patch: {
          proposalRefs: [
            ".Aegis/runs/run-1/patches/proposal-1.diff",
            ".Aegis/runs/run-1/patches/proposal-2.diff",
          ],
          digest: "sha256:abcdef012345",
          authorProviderFamily: "anthropic",
          reviewerProviderFamily: "google",
        },
        review: {
          verdict: "approved",
          digest: "sha256:abcdef012345",
          reviewedAt: 1735689600,
        },
        council: {
          decisionArtifactRef: ".Aegis/runs/run-1/council/decision.json",
          decidedAt: 1735689700,
        },
        applyLock: {
          lockID: "lock-1",
          ownerSessionID: "s-governance",
          ownerProviderFamily: "openai",
          ownerSubagent: "aegis-exec",
          acquiredAt: 1735689800,
        },
      },
    });

    const reloaded = new SessionStore(root);
    const state = reloaded.get("s-governance");
    expect(state.governance.patch.proposalRefs).toEqual([
      ".Aegis/runs/run-1/patches/proposal-1.diff",
      ".Aegis/runs/run-1/patches/proposal-2.diff",
    ]);
    expect(state.governance.patch.digest).toBe("sha256:abcdef012345");
    expect(state.governance.patch.authorProviderFamily).toBe("anthropic");
    expect(state.governance.patch.reviewerProviderFamily).toBe("google");
    expect(state.governance.review.verdict).toBe("approved");
    expect(state.governance.review.digest).toBe("sha256:abcdef012345");
    expect(state.governance.council.decisionArtifactRef).toBe(".Aegis/runs/run-1/council/decision.json");
    expect(state.governance.applyLock.lockID).toBe("lock-1");
    expect(state.governance.applyLock.ownerSessionID).toBe("s-governance");
    expect(state.governance.applyLock.ownerProviderFamily).toBe("openai");
  });

  it("fails closed to governance defaults when persisted governance metadata is malformed", () => {
    const root = makeRoot();
    const statePath = join(root, ".Aegis", "orchestrator_state.json");
    mkdirSync(join(root, ".Aegis"), { recursive: true });

    writeFileSync(
      statePath,
      `${JSON.stringify({
        schemaVersion: 2,
        sessions: {
          malformed: {
            ...JSON.parse(JSON.stringify(DEFAULT_STATE)),
            mode: "CTF",
            phase: "PLAN",
            latestCandidate: "flag{candidate}",
            governance: {
              patch: {
                proposalRefs: "not-an-array",
                digest: 123,
                authorProviderFamily: "invalid-family",
                reviewerProviderFamily: null,
              },
              review: {
                verdict: "maybe",
                digest: 42,
                reviewedAt: -1,
              },
              council: {
                decisionArtifactRef: ["bad"],
                decidedAt: "later",
              },
              applyLock: {
                lockID: ["bad"],
                ownerSessionID: {},
                ownerProviderFamily: "invalid-family",
                ownerSubagent: 99,
                acquiredAt: -100,
              },
            },
          },
        },
      }, null, 2)}\n`,
      "utf-8"
    );

    const store = new SessionStore(root);
    const loaded = store.get("malformed");
    expect(loaded.phase).toBe("PLAN");
    expect(loaded.latestCandidate).toBe("flag{candidate}");
    expect(loaded.governance.patch.proposalRefs).toEqual([]);
    expect(loaded.governance.patch.digest).toBe("");
    expect(loaded.governance.patch.authorProviderFamily).toBe("unknown");
    expect(loaded.governance.review.verdict).toBe("pending");
    expect(loaded.governance.review.digest).toBe("");
    expect(loaded.governance.council.decisionArtifactRef).toBe("");
    expect(loaded.governance.applyLock.ownerSessionID).toBe("");
    expect(loaded.governance.applyLock.ownerProviderFamily).toBe("unknown");
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

  it("submit_accepted transitions to CLOSED phase and disables autoLoop", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s-closed1", "CTF");
    store.applyEvent("s-closed1", "scan_completed");
    store.applyEvent("s-closed1", "plan_completed");
    store.applyEvent("s-closed1", "candidate_found");
    store.setAutoLoopEnabled("s-closed1", true); // enable before verify_success

    store.applyEvent("s-closed1", "verify_success");
    let state = store.get("s-closed1");
    expect(state.phase).toBe("SUBMIT");
    expect(state.autoLoopEnabled).toBe(false); // verify_success disables autoLoop

    store.setAutoLoopEnabled("s-closed1", true); // re-enable to test submit_accepted
    store.applyEvent("s-closed1", "submit_accepted");
    state = store.get("s-closed1");
    expect(state.phase).toBe("CLOSED");
    expect(state.submissionAccepted).toBe(true);
    expect(state.autoLoopEnabled).toBe(false);
  });

  it("terminal guard: events after CLOSED phase are ignored", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s-closed2", "CTF");
    store.applyEvent("s-closed2", "scan_completed");
    store.applyEvent("s-closed2", "plan_completed");
    store.applyEvent("s-closed2", "candidate_found");
    store.applyEvent("s-closed2", "verify_success");
    store.applyEvent("s-closed2", "submit_accepted");

    let state = store.get("s-closed2");
    expect(state.phase).toBe("CLOSED");
    const closedAt = state.lastUpdatedAt;

    store.applyEvent("s-closed2", "new_evidence");
    store.applyEvent("s-closed2", "no_new_evidence");
    store.applyEvent("s-closed2", "candidate_found");

    state = store.get("s-closed2");
    expect(state.phase).toBe("CLOSED");
    expect(state.submissionAccepted).toBe(true);
    expect(state.lastUpdatedAt).toBe(closedAt); // no change
  });

  it("verify_success disables autoLoopEnabled", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s-verify-loop", "CTF");
    store.applyEvent("s-verify-loop", "scan_completed");
    store.applyEvent("s-verify-loop", "plan_completed");
    store.applyEvent("s-verify-loop", "candidate_found");
    store.setAutoLoopEnabled("s-verify-loop", true);

    store.applyEvent("s-verify-loop", "verify_success");

    const state = store.get("s-verify-loop");
    expect(state.phase).toBe("SUBMIT");
    expect(state.autoLoopEnabled).toBe(false);
  });

  it("new_evidence idempotency: same candidate+evidence hash increments noNewEvidenceLoops", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s-idem", "CTF");
    store.setCandidate("s-idem", "flag{test}");

    store.applyEvent("s-idem", "new_evidence");
    let state = store.get("s-idem");
    expect(state.noNewEvidenceLoops).toBe(0);

    // Same candidate — hash matches → duplicate
    store.applyEvent("s-idem", "new_evidence");
    state = store.get("s-idem");
    expect(state.noNewEvidenceLoops).toBe(1);
    expect(state.lastFailureReason).toBe("hypothesis_stall");

    // Change candidate → new hash → loops reset
    store.setCandidate("s-idem", "flag{different}");
    store.applyEvent("s-idem", "new_evidence");
    state = store.get("s-idem");
    expect(state.noNewEvidenceLoops).toBe(0);
  });

  it("setManualVerifySuccess: throws without required evidence fields", () => {
    const store = new SessionStore(makeRoot());
    expect(() =>
      store.setManualVerifySuccess("s-mvs1", {
        verificationCommand: "",
        stdoutSummary: "some output",
      })
    ).toThrow("requires verificationCommand and stdoutSummary");
    expect(() =>
      store.setManualVerifySuccess("s-mvs1", {
        verificationCommand: "nc checker 1337",
        stdoutSummary: "",
      })
    ).toThrow("requires verificationCommand and stdoutSummary");
  });

  it("setManualVerifySuccess: advances to SUBMIT with evidence recorded", () => {
    const store = new SessionStore(makeRoot());
    store.setMode("s-mvs2", "CTF");
    store.applyEvent("s-mvs2", "scan_completed");
    store.applyEvent("s-mvs2", "plan_completed");
    store.applyEvent("s-mvs2", "candidate_found");

    const state = store.setManualVerifySuccess("s-mvs2", {
      verificationCommand: "nc checker 1337 < payload.bin",
      stdoutSummary: "Correct! flag{manual_verify}",
      artifactPath: ".Aegis/artifacts/checker-output.txt",
    });

    expect(state.phase).toBe("SUBMIT");
    expect(state.submissionPending).toBe(true);
    expect(state.autoLoopEnabled).toBe(false);
    const evidence = JSON.parse(state.latestAcceptanceEvidence) as {
      verificationCommand: string;
      stdoutSummary: string;
      artifactPath?: string;
    };
    expect(evidence.verificationCommand).toBe("nc checker 1337 < payload.bin");
    expect(evidence.stdoutSummary).toBe("Correct! flag{manual_verify}");
    expect(evidence.artifactPath).toBe(".Aegis/artifacts/checker-output.txt");
  });

  it("setIntent persists intentType and survives reload", () => {
    const root = makeRoot();
    const store = new SessionStore(root);
    store.setIntent("s-intent", "implement");

    expect(store.get("s-intent").intentType).toBe("implement");

    const reloaded = new SessionStore(root);
    expect(reloaded.get("s-intent").intentType).toBe("implement");
  });

  it("setProblemStateClass persists problemStateClass and survives reload", () => {
    const root = makeRoot();
    const store = new SessionStore(root);
    store.setProblemStateClass("s-psc", "deceptive");

    expect(store.get("s-psc").problemStateClass).toBe("deceptive");

    const reloaded = new SessionStore(root);
    expect(reloaded.get("s-psc").problemStateClass).toBe("deceptive");
  });

  it("setSolveLane sets lane and timestamp; null clears both", () => {
    const store = new SessionStore(makeRoot());
    const before = Date.now();
    store.setSolveLane("s-lane", "ctf-rev");

    const state = store.get("s-lane");
    expect(state.activeSolveLane).toBe("ctf-rev");
    expect(state.activeSolveLaneSetAt).toBeGreaterThanOrEqual(before);

    store.setSolveLane("s-lane", null);
    const cleared = store.get("s-lane");
    expect(cleared.activeSolveLane).toBeNull();
    expect(cleared.activeSolveLaneSetAt).toBe(0);
  });
});
