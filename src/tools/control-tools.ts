import type { ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
import { createAstGrepTools } from "./ast-tools";
import { createLspTools } from "./lsp-tools";
import { createAnalysisTools } from "./analysis-tools";
import { createClaudeSafeTools } from "./claude-safe-tools";
import { pickToolsByID } from "./control/pick-tools-by-id";
import { createOrchestrationStateSessionTools } from "./control/orchestration-state-session-tools";
import { createChannelTools } from "./control/channel-tools";
import { createGovernanceTools } from "./control/governance-tools";
import { createPtyTools } from "./control/pty-tools";
import { createMemoryTools } from "./control/memory-tools";
import { createReportReconParallelAdjacentTools } from "./control/report-recon-parallel-adjacent-tools";
import {
  ensureInsideProject as ensureInsideProjectHelper,
  blockIfBountyScopeUnconfirmed as blockIfBountyScopeUnconfirmedHelper,
} from "./control/helpers";
import type { ParallelBackgroundManager } from "../orchestration/parallel-background";
import type { NotesStore } from "../state/notes-store";
import { type SessionStore } from "../state/session-store";
import { normalizeSessionID } from "../state/session-id";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export function createControlTools(
  store: SessionStore,
  notesStore: NotesStore,
  config: OrchestratorConfig,
  projectDir: string,
  client: unknown,
  parallelBackgroundManager: ParallelBackgroundManager
): Record<string, ToolDefinition> {

  /* ---- curried helpers for governance deps ---- */

  const ensureInsideProject = (candidatePath: string) =>
    ensureInsideProjectHelper(projectDir, candidatePath);

  const buildToolProposalContext = (sessionID: string): {
    sandbox_cwd: string;
    run_id: string;
    manifest_ref: string;
    patch_diff_ref: string;
  } => {
    const normalizedSessionID = normalizeSessionID(sessionID);
    const runID = `tool-${normalizedSessionID}-${randomUUID()}`;
    const runRoot = join(projectDir, ".Aegis", "runs", runID);
    const sandboxCwd = resolve(join(runRoot, "sandbox"));
    mkdirSync(sandboxCwd, { recursive: true });
    return {
      sandbox_cwd: sandboxCwd,
      run_id: runID,
      manifest_ref: `.Aegis/runs/${runID}/run-manifest.json`,
      patch_diff_ref: `.Aegis/runs/${runID}/patches/proposal.diff`,
    };
  };

  const blockIfBountyScopeUnconfirmed = (sessionID: string, toolName: string): string | null =>
    blockIfBountyScopeUnconfirmedHelper(store, sessionID, toolName);

  /* ---- sub-module factories ---- */

  const astTools = createAstGrepTools({
    projectDir,
    getMode: (sessionID) => store.get(sessionID).mode,
  });

  const lspTools = createLspTools({ client, projectDir });
  const analysisTools = createAnalysisTools(store, notesStore, config);
  const claudeSafeTools = createClaudeSafeTools(projectDir);

  const orchestrationStateSessionTools = createOrchestrationStateSessionTools({
    store,
    notesStore,
    config,
    projectDir,
    client,
  });

  const channelTools = createChannelTools({ store });

  const memoryTools = createMemoryTools({ config, notesStore, projectDir });

  const governanceTools = createGovernanceTools({
    store,
    config,
    projectDir,
    ensureInsideProject,
    buildToolProposalContext,
  });

  const ptyTools = createPtyTools({ store, config, projectDir, client });

  const reportReconParallelAdjacentTools = createReportReconParallelAdjacentTools({
    store,
    notesStore,
    config,
    projectDir,
    client,
    parallelBackgroundManager,
    blockIfBountyScopeUnconfirmed,
  });

  /* ---- compose final tool map ---- */

  return {
    ...analysisTools,
    ...claudeSafeTools,
    ...astTools,
    ...lspTools,
    ...pickToolsByID(orchestrationStateSessionTools, [
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
    ]),
    ...channelTools,
    ...pickToolsByID(orchestrationStateSessionTools, [
      "ctf_orch_windows_cli_fallback",
      "ctf_orch_session_list",
      "ctf_orch_session_read",
      "ctf_orch_session_search",
      "ctf_orch_session_info",
    ]),
    ...memoryTools,
    ...pickToolsByID(orchestrationStateSessionTools, [
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
    ]),
    ...governanceTools,
    ...pickToolsByID(reportReconParallelAdjacentTools, [
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
    ]),
    ...ptyTools,
    ...pickToolsByID(reportReconParallelAdjacentTools, [
      "ctf_parallel_dispatch",
      "ctf_parallel_status",
      "ctf_parallel_collect",
      "ctf_parallel_abort",
    ]),
  };
}
