import type { SessionState } from "../state/types";

/**
 * 현재 phase/mode/targetType에 따라 에이전트가 사용해야 할
 * 핵심 Aegis 도구 목록을 간결하게 반환합니다. (~200 tokens 이내)
 */
export function buildToolGuide(state: SessionState): string {
  const lines: string[] = ["AEGIS TOOLS (use these to orchestrate):"];

  // 공통 도구
  lines.push("  ctf_orch_status          — show current orchestration state");
  lines.push("  ctf_orch_event <event>   — advance phase (scan_completed/plan_completed/candidate_found/verify_success/verify_fail)");

  switch (state.phase) {
    case "SCAN":
      lines.push("  ctf_auto_triage          — auto-classify target type");
      lines.push("  ctf_flag_scan            — scan output for flag patterns");
      lines.push("  ctf_orch_recon_plan      — generate recon pipeline");
      break;
    case "PLAN":
      lines.push("  ctf_hypothesis_register  — register hypotheses and experiments");
      lines.push("  ctf_orch_exploit_template_list — list exploit templates");
      lines.push("  ctf_orch_set_hypothesis  — set active hypothesis");
      break;
    case "EXECUTE":
      lines.push("  ctf_evidence_ledger      — record/query evidence");
      lines.push("  ctf_decoy_guard          — check if candidate is a decoy");
      if (state.targetType === "REV") {
        lines.push("  ctf_rev_loader_vm_detect — detect relocation-based VM");
        lines.push("  ctf_rev_entry_patch      — patch entry for dynamic extraction");
        lines.push("  ctf_rev_base255_codec    — encode/decode base255");
      }
      if (state.targetType === "PWN") {
        lines.push("  ctf_orch_env_parity      — check environment parity");
      }
      break;
    case "VERIFY":
      lines.push("  ctf_decoy_guard          — verify candidate is not a decoy");
      lines.push("  ctf_flag_scan            — rescan for flag patterns");
      break;
  }

  // 모드별 추가 도구
  if (state.mode === "CTF") {
    lines.push("  ctf_delta_scan           — scan for changes since last run");
    lines.push("  ctf_orch_report_generate — generate final write-up");
  }

  return lines.join("\n");
}
