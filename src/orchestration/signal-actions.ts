import type { SessionState } from "../state/types";

/**
 * 세션 상태에서 활성 신호를 읽어 에이전트 지침 문자열 배열을 생성.
 * 각 문자열은 system prompt에 직접 주입됩니다.
 */
export function buildSignalGuidance(state: SessionState): string[] {
  const lines: string[] = [];

  if (state.revVmSuspected || state.revLoaderVmDetected) {
    lines.push(
      "⚠ REV VM DETECTED: Static analysis is unreliable. Use ctf_rev_loader_vm_detect to map the VM and ctf_rev_entry_patch for dynamic extraction."
    );
  }

  if (state.decoySuspect) {
    const reason = state.decoySuspectReason ? ` (${state.decoySuspectReason})` : "";
    lines.push(
      `⚠ DECOY SUSPECT${reason}: Current flag candidate may be a decoy. Run ctf_decoy_guard to verify before submitting.`
    );
  }

  if (state.contradictionArtifactLockActive) {
    lines.push(
      "⚠ CONTRADICTION ACTIVE: Patch-and-dump extraction is mandatory. Use ctf_rev_entry_patch to extract runtime state."
    );
  }

  if (state.contradictionSLADumpRequired) {
    lines.push(
      "⚠ CONTRADICTION SLA: Direct state extraction required within this dispatch. Do not skip ctf_rev_entry_patch."
    );
  }

  if (state.noNewEvidenceLoops >= 2) {
    lines.push(
      `⚠ STUCK: No new evidence for ${state.noNewEvidenceLoops} loops. Change approach — use ctf_hypothesis_register to record alternatives.`
    );
  }

  if (state.revRiskScore > 0.3) {
    const signals = state.revRiskSignals.length > 0 ? ` signals=[${state.revRiskSignals.join(", ")}]` : "";
    lines.push(
      `⚠ HIGH REV RISK (score=${state.revRiskScore.toFixed(2)})${signals}: Prioritize dynamic analysis over static assumptions.`
    );
  }

  if (state.verifyFailCount >= 2) {
    lines.push(
      `⚠ REPEATED VERIFY FAILURES (${state.verifyFailCount}x): Consider whether the candidate is a decoy or constraints are wrong.`
    );
  }

  if (state.toolCallCount > 20 && state.aegisToolCallCount === 0) {
    lines.push(
      "⚠ AEGIS TOOLS NOT USED: You have made many tool calls without using any Aegis orchestration tools. Run ctf_orch_status to check state, then use ctf_orch_event to advance the phase."
    );
  }

  return lines;
}

/**
 * 현재 phase에 대한 행동 지침을 반환합니다.
 */
export function buildPhaseInstruction(state: SessionState): string {
  switch (state.phase) {
    case "SCAN":
      return (
        "PHASE INSTRUCTION (SCAN): Analyze the target and identify its type. " +
        "Use ctf_auto_triage to classify the target. " +
        "When analysis is complete, call: ctf_orch_event scan_completed"
      );
    case "PLAN":
      return (
        "PHASE INSTRUCTION (PLAN): Form hypotheses and build a TODO list. " +
        "Use ctf_hypothesis_register to record your hypotheses. " +
        "When the plan is ready, call: ctf_orch_event plan_completed"
      );
    case "EXECUTE":
      return (
        "PHASE INSTRUCTION (EXECUTE): Execute the in_progress TODO items. " +
        "Use ctf_evidence_ledger to record evidence. " +
        "When a flag candidate is found, call: ctf_orch_event candidate_found"
      );
    case "VERIFY":
      return (
        "PHASE INSTRUCTION (VERIFY): Validate the flag candidate against the oracle. " +
        "On success call: ctf_orch_event verify_success — On failure call: ctf_orch_event verify_fail"
      );
    case "SUBMIT":
      return "PHASE INSTRUCTION (SUBMIT): Submit the verified flag.";
    default:
      return "";
  }
}
