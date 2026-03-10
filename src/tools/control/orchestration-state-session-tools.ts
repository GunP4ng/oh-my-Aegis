import type { ToolDefinition } from "@opencode-ai/plugin";
import { pickToolsByID } from "./pick-tools-by-id";

export const createOrchestrationStateSessionTools = (
  registry: Record<string, ToolDefinition>
): Record<string, ToolDefinition> =>
  pickToolsByID(registry, [
    "ctf_orch_status",
    "ctf_orch_set_mode",
    "ctf_orch_set_subagent_profile",
    "ctf_orch_clear_subagent_profile",
    "ctf_orch_list_subagent_profiles",
    "ctf_orch_set_ultrawork",
    "ctf_orch_manual_verify",
    "ctf_orch_set_autoloop",
    "ctf_orch_event",
    "ctf_orch_metrics",
    "ctf_orch_next",
    "ctf_orch_windows_cli_fallback",
    "ctf_orch_session_list",
    "ctf_orch_session_read",
    "ctf_orch_session_search",
    "ctf_orch_session_info",
    "ctf_orch_postmortem",
    "ctf_orch_failover",
    "ctf_orch_check_budgets",
    "ctf_orch_compact",
    "ctf_orch_readiness",
    "ctf_orch_doctor",
    "ctf_orch_slash",
    "ctf_orch_exploit_template_list",
    "ctf_orch_exploit_template_get",
    "ctf_auto_triage",
    "ctf_gemini_cli",
    "ctf_claude_code",
  ]);
