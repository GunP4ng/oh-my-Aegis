import type { OrchestratorConfig } from "../config/schema";
import { extractSessionClient, type SessionClient } from "../orchestration/parallel";
import type { NotesStore } from "../state/notes-store";
import type { SessionStore } from "../state/session-store";
import { isContextLengthFailure } from "../risk/sanitize";
import { isRecord } from "../utils/is-record";
import { hasErrorResponse } from "../utils/sdk-response";
import { extractErrorMessage } from "./error-utils";
import { parseModelId } from "./model-id";

type ToastVariant = "info" | "success" | "warning" | "error";

const hasError = hasErrorResponse;

async function showToast(params: {
  client: unknown;
  directory: string;
  title: string;
  message: string;
  variant: ToastVariant;
}): Promise<void> {
  const tui = isRecord(params.client) ? params.client.tui : null;
  const toastFn = isRecord(tui) ? tui.showToast : null;
  if (typeof toastFn !== "function") return;

  const title = params.title.slice(0, 80);
  const message = params.message.slice(0, 240);
  const duration = 3_000;

  try {
    await (toastFn as (args: unknown) => Promise<unknown>)({
      directory: params.directory,
      title,
      message,
      variant: params.variant,
      duration,
    });
    return;
  } catch {}

  try {
    await (toastFn as (args: unknown) => Promise<unknown>)({
      query: { directory: params.directory },
      body: { title, message, variant: params.variant, duration },
    });
  } catch {}
}

type SummarizeArgs = {
  providerID: string;
  modelID: string;
};

function extractProviderModelFromMessageUpdated(props: Record<string, unknown>): SummarizeArgs | null {
  const info = isRecord(props.info) ? (props.info as Record<string, unknown>) : null;
  if (!info) return null;
  const providerID = typeof info.providerID === "string" ? info.providerID : "";
  const modelID = typeof info.modelID === "string" ? info.modelID : "";
  if (providerID && modelID) return { providerID, modelID };
  return null;
}

function toRatio(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0) {
    return null;
  }
  if (value <= 1) {
    return value;
  }
  if (value <= 100) {
    return value / 100;
  }
  return null;
}

export function extractContextUsageRatio(props: Record<string, unknown>): number | null {
  const info = isRecord(props.info) ? (props.info as Record<string, unknown>) : props;
  const directCandidates = [
    info.contextUsageRatio,
    info.context_window_ratio,
    info.contextWindowUsageRatio,
    info.contextWindowPercent,
    info.contextUsagePercent,
    info.tokenUsageRatio,
  ];

  for (const candidate of directCandidates) {
    const ratio = toRatio(candidate);
    if (ratio !== null) {
      return ratio;
    }
  }

  if (isRecord(info.usage)) {
    const usage = info.usage as Record<string, unknown>;
    const ratio = toRatio(usage.contextUsageRatio);
    if (ratio !== null) {
      return ratio;
    }
    const total = typeof usage.totalTokens === "number" ? usage.totalTokens : typeof usage.total_tokens === "number" ? usage.total_tokens : null;
    const window =
      typeof usage.contextWindowTokens === "number"
        ? usage.contextWindowTokens
        : typeof usage.context_window_tokens === "number"
          ? usage.context_window_tokens
          : null;
    if (typeof total === "number" && typeof window === "number" && window > 0) {
      return Math.max(0, Math.min(1, total / window));
    }
  }

  return null;
}

function getSummarizeFn(client: unknown): ((args: unknown) => Promise<unknown>) | null {
  if (!client || typeof client !== "object") return null;
  const session = (client as Record<string, unknown>).session;
  if (!session || typeof session !== "object") return null;
  const fn = (session as Record<string, unknown>).summarize;
  return typeof fn === "function" ? (fn as (args: unknown) => Promise<unknown>) : null;
}

function getPromptAsyncFn(client: unknown): ((args: unknown) => Promise<unknown>) | null {
  if (!client || typeof client !== "object") return null;
  const session = (client as Record<string, unknown>).session;
  if (!session || typeof session !== "object") return null;
  const fn = (session as Record<string, unknown>).promptAsync;
  return typeof fn === "function" ? (fn as (args: unknown) => Promise<unknown>) : null;
}

async function callSessionPromptAsync(params: {
  promptAsyncFn: (args: unknown) => Promise<unknown>;
  sessionID: string;
  directory: string;
  prompt: string;
}): Promise<boolean> {
  try {
    const result = await params.promptAsyncFn({
      sessionID: params.sessionID,
      directory: params.directory,
      text: params.prompt,
      source: "oh-my-Aegis.context-budget",
    });
    return !hasError(result);
  } catch {
    return false;
  }
}

async function callSessionSummarize(params: {
  summarizeFn: (args: unknown) => Promise<unknown>;
  sessionID: string;
  directory: string;
  providerID: string;
  modelID: string;
}): Promise<boolean> {
  try {
    const primary = await params.summarizeFn({
      path: { id: params.sessionID },
      body: { providerID: params.providerID, modelID: params.modelID },
      query: { directory: params.directory },
    });
    if (!hasError(primary)) return true;
  } catch {}

  try {
    const fallback = await params.summarizeFn({
      sessionID: params.sessionID,
      directory: params.directory,
      providerID: params.providerID,
      modelID: params.modelID,
    });
    return !hasError(fallback);
  } catch {
    return false;
  }
}

async function callSessionMessages(
  sessionClient: SessionClient,
  sessionID: string,
  directory: string,
  limit: number,
): Promise<unknown[] | null> {
  try {
    const primary = await sessionClient.messages({
      path: { id: sessionID },
      query: { directory, limit },
    });
    if (!hasError(primary) && Array.isArray((primary as { data?: unknown }).data)) {
      return (primary as { data: unknown[] }).data;
    }
  } catch {}

  try {
    const fallback = await sessionClient.messages({ sessionID, directory, limit });
    if (!hasError(fallback) && Array.isArray((fallback as { data?: unknown }).data)) {
      return (fallback as { data: unknown[] }).data;
    }
  } catch {}

  return null;
}

function extractLastAssistantProviderModel(messages: unknown[]): SummarizeArgs | null {
  let best: SummarizeArgs | null = null;
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    const info = isRecord(msg.info) ? (msg.info as Record<string, unknown>) : null;
    const role =
      typeof msg.role === "string" ? msg.role : info && typeof info.role === "string" ? String(info.role) : "";
    if (role !== "assistant") continue;
    const providerID = info && typeof info.providerID === "string" ? String(info.providerID) : "";
    const modelID = info && typeof info.modelID === "string" ? String(info.modelID) : "";
    if (providerID && modelID) {
      best = { providerID, modelID };
    }
  }
  return best;
}

export function createContextWindowRecoveryManager(params: {
  client: unknown;
  directory: string;
  notesStore: NotesStore;
  config: OrchestratorConfig;
  store: SessionStore;
  getDefaultModel?: (sessionID: string) => string | undefined;
}): {
  handleEvent: (type: string, props: Record<string, unknown>) => Promise<void>;
  handleContextFailureText: (sessionID: string, text: string) => Promise<void>;
} {
  const sessionClient = extractSessionClient(params.client);
  const summarizeFn = getSummarizeFn(params.client);
  const promptAsyncFn = getPromptAsyncFn(params.client);

  const inProgress = new Set<string>();
  const lastAttemptAt = new Map<string, number>();
  const attemptCount = new Map<string, number>();
  const proactiveArmed = new Set<string>();

  const shouldAttempt = (sessionID: string): boolean => {
    const now = Date.now();
    const last = lastAttemptAt.get(sessionID) ?? 0;
    if (now - last < params.config.recovery.context_window_recovery_cooldown_ms) {
      return false;
    }
    const count = attemptCount.get(sessionID) ?? 0;
    if (count >= params.config.recovery.context_window_recovery_max_attempts_per_session) {
      return false;
    }
    return true;
  };

  const recordAttempt = (sessionID: string): void => {
    lastAttemptAt.set(sessionID, Date.now());
    attemptCount.set(sessionID, (attemptCount.get(sessionID) ?? 0) + 1);
  };

  const recover = async (
    sessionID: string,
    summarizeArgs: SummarizeArgs,
    reason: string,
    options?: { recordStateEvent?: boolean; proactiveRatio?: number; injectPrompt?: boolean },
  ): Promise<void> => {
    if (!params.config.recovery.enabled || !params.config.recovery.context_window_recovery) return;
    if (!sessionClient || !summarizeFn) return;
    if (inProgress.has(sessionID)) return;
    if (!shouldAttempt(sessionID)) {
      params.notesStore.recordScan(
        `Context window recovery skipped: budget/cooldown session=${sessionID} reason=${reason}`
      );
      return;
    }

      if (options?.recordStateEvent) {
        params.store.applyEvent(sessionID, "context_length_exceeded");
        if (params.config.recovery.auto_compact_on_context_failure) {
          const actions = params.notesStore.compactNow();
          for (const action of actions) {
            params.notesStore.recordScan(`Context overflow note compaction: ${action} session=${sessionID}`);
          }
        }
      } else if (typeof options?.proactiveRatio === "number" && params.config.recovery.auto_compact_on_context_failure) {
        const actions = params.notesStore.compactNow();
        for (const action of actions) {
          params.notesStore.recordScan(
            `Proactive context compaction: ratio=${options.proactiveRatio.toFixed(3)} action=${action} session=${sessionID}`
          );
        }
      }

    inProgress.add(sessionID);
    recordAttempt(sessionID);
    try {
      await showToast({
        client: params.client,
        directory: params.directory,
        title: "oh-my-Aegis: context recovery",
        message: "Context limit hit. Summarizing session...",
        variant: "warning",
      });

      const ok = await callSessionSummarize({
        summarizeFn,
        sessionID,
        directory: params.directory,
        providerID: summarizeArgs.providerID,
        modelID: summarizeArgs.modelID,
      });

      params.notesStore.recordScan(
        `Context window recovery attempt: ok=${ok} provider=${summarizeArgs.providerID} model=${summarizeArgs.modelID} session=${sessionID} reason=${reason}`
      );

      if (ok) {
        if (options?.injectPrompt && promptAsyncFn) {
          const state = params.store.get(sessionID);
          const ratioText =
            typeof options?.proactiveRatio === "number" ? `${Math.round(options.proactiveRatio * 100)}%` : "high";
          const prompt = [
            "[oh-my-Aegis context-budget]",
            `Context usage reached ${ratioText}; proactive compaction + summarize completed.`,
            "Continue in manager mode: delegate with task subagents and avoid direct execution.",
            "Preserve continuity from durable logs: STATE/WORKLOG/EVIDENCE/CONTEXT_PACK.",
            `Current state: mode=${state.mode} phase=${state.phase} target=${state.targetType}`,
          ].join("\n");
          const injected = await callSessionPromptAsync({
            promptAsyncFn,
            sessionID,
            directory: params.directory,
            prompt,
          });
          params.notesStore.recordScan(
            `Context budget continuation prompt injected: ok=${injected} session=${sessionID}`
          );
        }
        await showToast({
          client: params.client,
          directory: params.directory,
          title: "oh-my-Aegis: context recovered",
          message: "Session summarized. Retry the last step.",
          variant: "success",
        });
      }
    } finally {
      inProgress.delete(sessionID);
    }
  };

  const deriveSummarizeArgs = async (sessionID: string, props?: Record<string, unknown>): Promise<SummarizeArgs> => {
    const fromUpdated = props ? extractProviderModelFromMessageUpdated(props) : null;
    if (fromUpdated) return fromUpdated;

    if (sessionClient) {
      const messages = await callSessionMessages(sessionClient, sessionID, params.directory, 60);
      if (messages) {
        const last = extractLastAssistantProviderModel(messages);
        if (last) return last;
      }
    }

    const model = typeof params.getDefaultModel === "function" ? params.getDefaultModel(sessionID) ?? "" : "";
    const parsed = parseModelId(model);
    return {
      providerID: parsed.providerID,
      modelID: parsed.modelID,
    };
  };

  const handleContextFailureText = async (sessionID: string, text: string): Promise<void> => {
    if (!params.config.recovery.enabled || !params.config.recovery.context_window_recovery) return;
    if (!isContextLengthFailure(text)) return;
    const summarizeArgs = await deriveSummarizeArgs(sessionID);
    await recover(sessionID, summarizeArgs, "tool.execute.after", { recordStateEvent: false });
  };

  const handleEvent = async (type: string, props: Record<string, unknown>): Promise<void> => {
    if (!params.config.recovery.enabled || !params.config.recovery.context_window_recovery) return;

    if (type === "session.error") {
      const sessionID = typeof props.sessionID === "string" ? props.sessionID : "";
      const error = props.error;
      const message = extractErrorMessage(error);
      if (!sessionID || !isContextLengthFailure(message)) return;
      const summarizeArgs = await deriveSummarizeArgs(sessionID);
      await recover(sessionID, summarizeArgs, "session.error", { recordStateEvent: true });
      return;
    }

    if (type === "message.updated") {
      const info = isRecord(props.info) ? (props.info as Record<string, unknown>) : null;
      if (!info) return;
      const sessionID = typeof info.sessionID === "string" ? info.sessionID : "";
      const role = typeof info.role === "string" ? info.role : "";
      const error = info.error;
      const message = extractErrorMessage(error);
      if (!sessionID || role !== "assistant") return;
      if (message && isContextLengthFailure(message)) {
        const summarizeArgs = await deriveSummarizeArgs(sessionID, props);
        await recover(sessionID, summarizeArgs, "message.updated", { recordStateEvent: true });
        return;
      }

      if (!params.config.recovery.context_window_proactive_compaction) {
        return;
      }
      const ratio = extractContextUsageRatio(props);
      if (ratio === null) {
        return;
      }
      const threshold = params.config.recovery.context_window_proactive_threshold_ratio;
      const rearm = Math.min(
        threshold - 0.01,
        params.config.recovery.context_window_proactive_rearm_ratio,
      );
      if (ratio <= rearm) {
        proactiveArmed.delete(sessionID);
        return;
      }
      if (ratio < threshold || proactiveArmed.has(sessionID)) {
        return;
      }
      proactiveArmed.add(sessionID);
      const summarizeArgs = await deriveSummarizeArgs(sessionID, props);
      await recover(sessionID, summarizeArgs, "message.updated.proactive", {
        recordStateEvent: false,
        proactiveRatio: ratio,
        injectPrompt: true,
      });
    }
  };

  return { handleEvent, handleContextFailureText };
}
