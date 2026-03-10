import type { ToolDefinition } from "@opencode-ai/plugin";
import { pickToolsByID } from "./pick-tools-by-id";

export const createReportReconParallelAdjacentTools = (
  registry: Record<string, ToolDefinition>
): Record<string, ToolDefinition> =>
  pickToolsByID(registry, [
    "ctf_flag_scan",
    "ctf_pattern_match",
    "ctf_recon_pipeline",
    "ctf_delta_scan",
    "ctf_tool_recommend",
    "ctf_libc_lookup",
    "ctf_env_parity",
    "ctf_parity_runner",
    "ctf_contradiction_runner",
    "ctf_evidence_ledger",
    "ctf_report_generate",
    "ctf_subagent_dispatch",
    "ctf_parallel_dispatch",
    "ctf_parallel_status",
    "ctf_parallel_collect",
    "ctf_parallel_abort",
  ]);
