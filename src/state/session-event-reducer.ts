import type { SessionEvent, SessionState } from "./types";

export const CONTRADICTION_PATCH_LOOP_BUDGET = 2;

type SessionEventReducerDeps = {
  now: () => number;
  computeCandidateHash: (state: SessionState) => string;
};

function clearLoopGuard(state: SessionState): void {
  state.loopGuard.blockedActionSignature = "";
  state.loopGuard.blockedReason = "";
  state.loopGuard.blockedAt = 0;
}

function resetContradictionState(state: SessionState): void {
  state.contradictionPivotDebt = 0;
  state.contradictionPatchDumpDone = false;
  state.contradictionArtifactLockActive = false;
  state.contradictionArtifacts = [];
}

function clearFailureState(state: SessionState): void {
  state.lastFailureReason = "none";
  state.lastFailureSummary = "";
  state.lastFailedRoute = "";
  state.lastFailureAt = 0;
}

export function applySessionEvent(
  state: SessionState,
  event: SessionEvent,
  deps: SessionEventReducerDeps,
): void {
  switch (event) {
    case "scan_completed":
      state.phase = "PLAN";
      break;
    case "plan_completed":
      state.phase = state.candidatePendingVerification ? "VERIFY" : "EXECUTE";
      break;
    case "candidate_found":
      state.candidatePendingVerification = true;
      state.candidateLevel = "L1";
      state.submissionPending = false;
      state.submissionAccepted = false;
      state.latestAcceptanceEvidence = "";
      if (state.phase === "PLAN" || state.phase === "EXECUTE") {
        state.phase = "VERIFY";
      }
      state.contextFailCount = Math.max(0, state.contextFailCount - 1);
      state.timeoutFailCount = Math.max(0, state.timeoutFailCount - 1);
      break;
    case "verify_success":
      state.candidatePendingVerification = false;
      state.candidateLevel = "L2";
      state.phase = "SUBMIT";
      state.submissionPending = true;
      state.submissionAccepted = false;
      state.autoLoopEnabled = false;
      clearFailureState(state);
      state.verifyFailCount = 0;
      state.noNewEvidenceLoops = 0;
      state.samePayloadLoops = 0;
      state.staleToolPatternLoops = 0;
      state.lastToolPattern = "";
      resetContradictionState(state);
      clearLoopGuard(state);
      break;
    case "verify_fail":
      state.candidatePendingVerification = false;
      state.phase = "EXECUTE";
      state.submissionPending = false;
      state.submissionAccepted = false;
      state.latestAcceptanceEvidence = "";
      state.candidateLevel = state.latestCandidate.trim().length > 0 ? "L1" : "L0";
      state.verifyFailCount += 1;
      state.noNewEvidenceLoops += 1;
      state.lastFailureReason = "verification_mismatch";
      state.failureReasonCounts.verification_mismatch += 1;
      state.lastFailureAt = deps.now();
      break;
    case "submit_accepted":
      state.phase = "CLOSED";
      state.submissionPending = false;
      state.submissionAccepted = true;
      state.autoLoopEnabled = false;
      state.candidateLevel = "L3";
      if (!state.latestVerified && state.latestCandidate) {
        state.latestVerified = state.latestCandidate;
      }
      clearFailureState(state);
      state.verifyFailCount = 0;
      state.noNewEvidenceLoops = 0;
      state.samePayloadLoops = 0;
      state.staleToolPatternLoops = 0;
      state.lastToolPattern = "";
      resetContradictionState(state);
      state.mdScribePrimaryStreak = 0;
      state.pendingTaskFailover = false;
      state.taskFailoverCount = 0;
      clearLoopGuard(state);
      break;
    case "submit_rejected":
      state.phase = "EXECUTE";
      state.submissionPending = false;
      state.submissionAccepted = false;
      state.candidateLevel = state.latestCandidate.trim().length > 0 ? "L1" : "L0";
      state.verifyFailCount += 1;
      state.lastFailureReason = "verification_mismatch";
      state.failureReasonCounts.verification_mismatch += 1;
      state.lastFailureAt = deps.now();
      break;
    case "no_new_evidence":
      state.noNewEvidenceLoops += 1;
      state.lastFailureReason = "hypothesis_stall";
      state.failureReasonCounts.hypothesis_stall += 1;
      state.lastFailureAt = deps.now();
      break;
    case "same_payload_repeat":
      state.samePayloadLoops += 1;
      state.lastFailureReason = "hypothesis_stall";
      state.failureReasonCounts.hypothesis_stall += 1;
      state.lastFailureAt = deps.now();
      break;
    case "new_evidence": {
      if (state.submissionAccepted) {
        break;
      }
      const currentHash = deps.computeCandidateHash(state);
      if (currentHash === state.lastCandidateHash && currentHash !== "") {
        state.noNewEvidenceLoops += 1;
        state.lastFailureReason = "hypothesis_stall";
        state.failureReasonCounts.hypothesis_stall += 1;
        state.lastFailureAt = deps.now();
        break;
      }
      state.lastCandidateHash = currentHash;
      if (state.phase === "VERIFY" || state.phase === "SUBMIT") {
        state.phase = "EXECUTE";
      }
      state.noNewEvidenceLoops = 0;
      state.samePayloadLoops = 0;
      state.staleToolPatternLoops = 0;
      state.lastToolPattern = "";
      resetContradictionState(state);
      state.submissionPending = false;
      state.submissionAccepted = false;
      state.latestAcceptanceEvidence = "";
      state.candidateLevel = state.latestCandidate.trim().length > 0 ? "L1" : "L0";
      state.pendingTaskFailover = false;
      state.taskFailoverCount = 0;
      clearFailureState(state);
      state.contextFailCount = Math.max(0, state.contextFailCount - 1);
      state.timeoutFailCount = Math.max(0, state.timeoutFailCount - 1);
      clearLoopGuard(state);
      break;
    }
    case "readonly_inconclusive":
      state.readonlyInconclusiveCount += 1;
      break;
    case "scope_confirmed":
      state.scopeConfirmed = true;
      clearLoopGuard(state);
      break;
    case "context_length_exceeded":
      state.contextFailCount += 1;
      state.lastFailureReason = "context_overflow";
      state.failureReasonCounts.context_overflow += 1;
      state.lastFailureAt = deps.now();
      break;
    case "timeout":
      state.timeoutFailCount += 1;
      state.lastFailureReason = "tooling_timeout";
      state.failureReasonCounts.tooling_timeout += 1;
      state.lastFailureAt = deps.now();
      break;
    case "unsat_claim":
      state.lastFailureReason = "unsat_claim";
      state.failureReasonCounts.unsat_claim += 1;
      state.lastFailureAt = deps.now();
      break;
    case "static_dynamic_contradiction":
      state.lastFailureReason = "static_dynamic_contradiction";
      state.failureReasonCounts.static_dynamic_contradiction += 1;
      state.lastFailureAt = deps.now();
      state.contradictionPivotDebt = CONTRADICTION_PATCH_LOOP_BUDGET;
      state.contradictionPatchDumpDone = false;
      state.contradictionArtifactLockActive = true;
      state.contradictionArtifacts = [];
      break;
    case "decoy_suspect":
      if (!state.decoySuspect) {
        state.decoySuspect = true;
      }
      if (state.decoySuspectReason.trim().length === 0) {
        state.decoySuspectReason = "decoy_suspect event applied";
      }
      break;
    case "oracle_progress":
      state.oracleProgressUpdatedAt = deps.now();
      break;
    case "replay_low_trust":
      break;
    case "contradiction_sla_dump_done":
      if (!state.contradictionPatchDumpDone) {
        state.contradictionPatchDumpDone = true;
      }
      if (state.contradictionSLADumpRequired) {
        state.contradictionSLADumpRequired = false;
      }
      if (state.contradictionArtifactLockActive) {
        state.contradictionArtifactLockActive = false;
      }
      if (state.contradictionPivotDebt !== 0) {
        state.contradictionPivotDebt = 0;
      }
      break;
    case "unsat_cross_validated":
      if (state.unsatCrossValidationCount < 99) {
        state.unsatCrossValidationCount = Math.min(99, state.unsatCrossValidationCount + 1);
      }
      break;
    case "unsat_unhooked_oracle":
      if (!state.unsatUnhookedOracleRun) {
        state.unsatUnhookedOracleRun = true;
      }
      break;
    case "unsat_artifact_digest":
      if (!state.unsatArtifactDigestVerified) {
        state.unsatArtifactDigestVerified = true;
      }
      break;
    case "reset_loop":
      state.phase = "SCAN";
      state.noNewEvidenceLoops = 0;
      state.samePayloadLoops = 0;
      state.staleToolPatternLoops = 0;
      state.lastToolPattern = "";
      resetContradictionState(state);
      state.candidateLevel = state.latestVerified.trim().length > 0 ? "L3" : "L0";
      state.submissionPending = false;
      state.submissionAccepted = state.latestVerified.trim().length > 0;
      state.latestAcceptanceEvidence = "";
      state.mdScribePrimaryStreak = 0;
      state.readonlyInconclusiveCount = 0;
      clearFailureState(state);
      clearLoopGuard(state);
      break;
  }
}
