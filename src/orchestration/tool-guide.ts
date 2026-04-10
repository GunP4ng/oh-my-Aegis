import type { SessionState } from "../state/types";
import { getAllowedDirectDiscoveryToolSummary, type AegisGuidanceRole } from "../helpers/plugin-utils";

/**
 * Issue 9: 2-tier tool guide
 * Tier 1: Domain playbook (sub-agent delegation)
 * Tier 2: Skill tools (specific orchestration tools)
 */
export function buildToolGuide(state: SessionState, role: AegisGuidanceRole = "worker"): string {
  const lines: string[] = ["AEGIS TOOLS (use these to orchestrate):"];

  // Tier 1: Domain playbook - which sub-agent to delegate to
  lines.push("  [Tier 1: Domain Playbook / Delegation]");
  switch (state.targetType) {
    case "REV":
      lines.push("  → ctf-rev (static analysis), aegis-deep (dynamic), ctf-verify (oracle)");
      break;
    case "PWN":
      lines.push("  → ctf-pwn (exploit dev), ctf-verify (oracle check)");
      break;
    case "WEB_API":
      lines.push("  → ctf-web (recon/attack), ctf-research (deep analysis), ctf-verify");
      break;
    case "WEB3":
      lines.push("  → ctf-web3 (contract), ctf-research (analysis)");
      break;
    case "CRYPTO":
      lines.push("  → ctf-crypto (cryptanalysis), ctf-verify (oracle)");
      break;
    case "FORENSICS":
      lines.push("  → ctf-forensics (artifact), ctf-verify (oracle)");
      break;
    default:
      lines.push("  → ctf-explore (MISC/UNKNOWN), ctf-research (deep analysis)");
  }

  if (role === "manager" || role === "planning") {
    lines.push("  [Tier 2: Direct Tools Allowed In This Role]");
    lines.push("  ctf_orch_status          — show current orchestration state");
    lines.push("  ctf_orch_event <event>   — update phase or evidence state when warranted");
    lines.push(
      `  direct discovery only    — ${getAllowedDirectDiscoveryToolSummary(role)} (routing/verification aid only)`
    );
    lines.push("  domain analysis/execution — delegate to Tier 1 sub-agents instead of calling phase tools directly");
    return lines.join("\n");
  }

  // Tier 2: Skill tools - specific tools in current phase
  lines.push("  [Tier 2: Skill Tools / Phase-specific]");
  lines.push("  ctf_orch_status          — show current orchestration state");
  lines.push("  ctf_orch_event <event>   — advance phase (scan_completed/plan_completed/candidate_found/verify_success/verify_fail)");

  switch (state.phase) {
    case "SCAN":
      lines.push("  ctf_auto_triage          — auto-classify target type");
      lines.push("  ctf_flag_scan            — scan output for flag patterns");
      lines.push("  ctf_recon_pipeline       — generate recon pipeline");
      break;
    case "PLAN":
      lines.push("  ctf_hypothesis_register  — register hypotheses and experiments");
      lines.push("  ctf_orch_exploit_template_list — list exploit templates");
      lines.push("  ctf_gemini_cli           — call Gemini CLI for 2nd opinion");
      break;
    case "EXECUTE":
      lines.push("  ctf_evidence_ledger      — record/query evidence");
      lines.push("  ctf_decoy_guard          — check if candidate is a decoy");
      if (state.targetType === "REV") {
        lines.push("  ctf_rev_loader_vm_detect — detect relocation-based VM  [REV skill]");
        lines.push("  ctf_rev_entry_patch      — patch entry for dynamic extraction  [REV skill]");
        lines.push("  ctf_rev_base255_codec    — encode/decode base255  [REV skill]");
      }
      if (state.targetType === "PWN") {
        lines.push("  ctf_env_parity           — check environment parity  [PWN skill]");
      }
      break;
    case "VERIFY":
      lines.push("  ctf_decoy_guard          — verify candidate is not a decoy");
      lines.push("  ctf_flag_scan            — rescan for flag patterns");
      break;
  }

  if (state.mode === "CTF") {
    lines.push("  ctf_delta_scan           — scan for changes since last run");
    lines.push("  ctf_report_generate      — generate final write-up");
  }

  return lines.join("\n");
}
