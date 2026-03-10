import type { OrchestratorConfig } from "../config/schema";
import { callSessionPromptAsync, hasSessionPromptAsync } from "./opencode-client-compat";
import type { SessionState } from "../state/types";
import type { RouteDecision } from "../types/route-decision";

type AutoLoopStore = {
  get: (sessionID: string) => SessionState;
  setAutoLoopEnabled: (sessionID: string, enabled: boolean) => SessionState;
  recordAutoLoopPrompt: (sessionID: string) => SessionState;
};

type ToastParams = {
  sessionID: string;
  key: string;
  title: string;
  message: string;
  variant: "info" | "warning" | "error" | "success";
  durationMs?: number;
};

export function createAutoLoopRunner(params: {
  config: OrchestratorConfig;
  store: AutoLoopStore;
  client: unknown;
  directory: string;
  note: (label: string, message: string) => void;
  noteHookError: (label: string, error: unknown) => void;
  maybeShowToast: (params: ToastParams) => Promise<void>;
  logRouteDecision: (sessionID: string, state: SessionState, decision: RouteDecision, source: string) => void;
  route: (state: SessionState, config: OrchestratorConfig) => RouteDecision;
  buildWorkPackage: (state: SessionState) => string;
  consumeSearchModeGuidance: (sessionID: string) => boolean;
}) {
  const sendSessionPromptAsync = async (sessionID: string, text: string, metadata: Record<string, unknown>) => {
    const parts = [
      {
        type: "text",
        text,
        synthetic: true,
        metadata,
      },
    ];

    const attempts: unknown[] = [
      { path: { id: sessionID }, query: { directory: params.directory }, body: { parts } },
      { sessionID, directory: params.directory, parts },
    ];
    const result = await callSessionPromptAsync(params.client, attempts);
    return result.ok;
  };

  return async function runAutoLoopTick(sessionID: string, trigger: string): Promise<void> {
    if (!params.config.auto_loop.enabled) {
      return;
    }
    const state = params.store.get(sessionID);
    if (state.phase === "CLOSED" || state.submissionAccepted) {
      params.store.setAutoLoopEnabled(sessionID, false);
      return;
    }
    if (!state.modeExplicit) {
      return;
    }
    if (!state.autoLoopEnabled) {
      return;
    }
    if (params.config.auto_loop.only_when_ultrawork && !state.ultraworkEnabled) {
      return;
    }
    if (params.config.auto_loop.stop_on_verified && state.mode === "CTF" && state.latestVerified.trim().length > 0) {
      params.store.setAutoLoopEnabled(sessionID, false);
      params.note("autoloop.stop", "Auto loop stopped: submission accepted evidence present.");
      await params.maybeShowToast({
        sessionID,
        key: "autoloop_stop_verified",
        title: "oh-my-Aegis: autoloop stopped",
        message: "Verified output present; autoloop disabled.",
        variant: "info",
      });
      return;
    }

    const now = Date.now();
    if (state.autoLoopLastPromptAt > 0 && now - state.autoLoopLastPromptAt < params.config.auto_loop.idle_delay_ms) {
      return;
    }

    if (state.autoLoopIterations >= params.config.auto_loop.max_iterations) {
      params.store.setAutoLoopEnabled(sessionID, false);
      params.note("autoloop.stop", `Auto loop stopped: max iterations reached (${params.config.auto_loop.max_iterations}).`);
      return;
    }

    const decision = params.route(state, params.config);
    params.logRouteDecision(sessionID, state, decision, "auto_loop");
    const iteration = state.autoLoopIterations + 1;
    const workPackage = params.buildWorkPackage(state);
    const promptLines = [
      "[oh-my-Aegis auto-loop]",
      `trigger=${trigger} iteration=${iteration}`,
      `next_route=${decision.primary}`,
      `work_package=${workPackage}`,
      "Rules:",
      "- Build/update a short execution plan first, then reflect it in todowrite.",
      "- Keep 2-6 TODO items when possible; allow multiple pending items but only one in_progress.",
      "- Execute via the next_route (use the task tool once with non-empty, specific args).",
      "- Record progress with ctf_orch_event and stop this turn.",
      "- Do NOT output internal reasoning or planning as user-facing text; send only results, progress summaries, or questions to the user.",
    ];
    if (params.consumeSearchModeGuidance(sessionID)) {
      promptLines.push(
        "- [search-mode] active: immediately run ctf_parallel_dispatch plan=scan and ctf_subagent_dispatch type=librarian; then collect with ctf_parallel_collect message_limit=5 and pick a winner if clear.",
      );
    }
    const promptText = promptLines.join("\n");

    if (!hasSessionPromptAsync(params.client)) {
      params.store.setAutoLoopEnabled(sessionID, false);
      params.note("autoloop.error", "Auto loop disabled: client.session.promptAsync unavailable.");
      return;
    }

    params.store.recordAutoLoopPrompt(sessionID);
    params.note("autoloop.tick", `Auto loop tick: session=${sessionID} route=${decision.primary} (${trigger})`);

    try {
      const sent = await sendSessionPromptAsync(sessionID, promptText, {
        source: "oh-my-Aegis.auto-loop",
        iteration,
        next_route: decision.primary,
      });
      if (sent) {
        return;
      }
      params.store.setAutoLoopEnabled(sessionID, false);
      params.note("autoloop.error", "Auto loop disabled: failed to send promptAsync.");
      params.noteHookError("autoloop", new Error("promptAsync failed for all supported payload shapes"));
    } catch (error) {
      params.store.setAutoLoopEnabled(sessionID, false);
      params.note("autoloop.error", "Auto loop disabled: failed to send promptAsync.");
      params.noteHookError("autoloop", error);
    }
  };
}
