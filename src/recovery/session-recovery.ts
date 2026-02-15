import type { OrchestratorConfig } from "../config/schema";
import { extractSessionClient, type SessionClient } from "../orchestration/parallel";
import type { NotesStore } from "../state/notes-store";
import type { SessionStore } from "../state/session-store";
import { extractErrorMessage } from "./error-utils";

type ToastVariant = "info" | "success" | "warning" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasError(result: unknown): boolean {
  if (!isRecord(result)) return false;
  return Boolean(result.error);
}

export type SessionRecoveryErrorType =
  | "tool_result_missing"
  | "thinking_block_order"
  | "thinking_disabled_violation"
  | "assistant_prefill_unsupported";

export function detectSessionRecoveryErrorType(error: unknown): SessionRecoveryErrorType | null {
  const message = extractErrorMessage(error).toLowerCase();
  if (!message) return null;

  if (
    message.includes("assistant message prefill") ||
    message.includes("conversation must end with a user message")
  ) {
    return "assistant_prefill_unsupported";
  }

  if (message.includes("thinking is disabled") && message.includes("cannot contain")) {
    return "thinking_disabled_violation";
  }

  if (
    message.includes("thinking") &&
    (message.includes("first block") ||
      message.includes("must start with") ||
      message.includes("preced") ||
      message.includes("final block") ||
      message.includes("cannot be thinking") ||
      (message.includes("expected") && message.includes("found")))
  ) {
    return "thinking_block_order";
  }

  if (message.includes("tool_use") && message.includes("tool_result")) {
    return "tool_result_missing";
  }

  return null;
}

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

async function callSessionAbort(sessionClient: SessionClient, sessionID: string, directory: string): Promise<void> {
  try {
    const primary = await sessionClient.abort({ path: { id: sessionID }, query: { directory } });
    if (!hasError(primary)) return;
  } catch {}

  try {
    await sessionClient.abort({ sessionID, directory });
  } catch {}
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

async function callSessionPromptParts(
  sessionClient: SessionClient,
  sessionID: string,
  directory: string,
  parts: unknown[],
): Promise<boolean> {
  try {
    const primary = await sessionClient.promptAsync({
      path: { id: sessionID },
      query: { directory },
      body: { parts },
    });
    if (!hasError(primary)) return true;
  } catch {}

  try {
      const fallback = await sessionClient.promptAsync({ sessionID, directory, parts });
      return !hasError(fallback);
  } catch {
    return false;
  }
}

function findMessageById(messages: unknown[], messageID: string): { info: Record<string, unknown>; parts: unknown[] } | null {
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    const info = isRecord(msg.info) ? (msg.info as Record<string, unknown>) : null;
    const topId = typeof msg.id === "string" ? msg.id : "";
    const infoId = info && typeof info.id === "string" ? String(info.id) : "";
    const id = infoId || topId;
    if (!id || id !== messageID) continue;
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    return { info: info ?? {}, parts };
  }
  return null;
}

function extractToolUses(parts: unknown[]): Array<{ id: string; name: string }> {
  const uses: Array<{ id: string; name: string }> = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    const type = typeof part.type === "string" ? part.type : "";
    if (type !== "tool_use" && type !== "tool") continue;
    const id =
      typeof part.id === "string"
        ? part.id
        : typeof part.callID === "string"
          ? part.callID
          : "";
    if (!id) continue;
    const name = typeof part.name === "string" ? part.name : "";
    uses.push({ id, name });
  }
  const seen = new Set<string>();
  const deduped: Array<{ id: string; name: string }> = [];
  for (const u of uses) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    deduped.push(u);
  }
  return deduped;
}

function extractMessageInfoFromUpdatedEvent(props: Record<string, unknown>): {
  sessionID: string;
  messageID: string;
  role: string;
  error: unknown;
} | null {
  const info = isRecord(props.info) ? (props.info as Record<string, unknown>) : null;
  if (!info) return null;

  const role = typeof info.role === "string" ? info.role : "";
  const sessionID = typeof info.sessionID === "string" ? info.sessionID : "";
  const messageID = typeof info.id === "string" ? info.id : "";
  const error = info.error;
  if (!sessionID || !messageID || !role || !error) return null;
  return { sessionID, messageID, role, error };
}

export function createSessionRecoveryManager(params: {
  client: unknown;
  directory: string;
  notesStore: NotesStore;
  config: OrchestratorConfig;
  store: SessionStore;
}): {
  isRecoverableError: (error: unknown) => boolean;
  handleEvent: (type: string, props: Record<string, unknown>) => Promise<void>;
} {
  const sessionClient = extractSessionClient(params.client);
  const processingByMessageID = new Set<string>();

  const isRecoverableError = (error: unknown): boolean => {
    return detectSessionRecoveryErrorType(error) !== null;
  };

  const handleEvent = async (type: string, props: Record<string, unknown>): Promise<void> => {
    if (!params.config.recovery.enabled || !params.config.recovery.session_recovery) {
      return;
    }
    if (!sessionClient) {
      return;
    }
    if (type !== "message.updated") {
      return;
    }

    const info = extractMessageInfoFromUpdatedEvent(props);
    if (!info) {
      return;
    }
    if (info.role !== "assistant") {
      return;
    }

    const errorType = detectSessionRecoveryErrorType(info.error);
    if (!errorType) {
      return;
    }

    if (processingByMessageID.has(info.messageID)) {
      return;
    }
    processingByMessageID.add(info.messageID);

    try {
      const state = params.store.get(info.sessionID);
      const summary = extractErrorMessage(info.error).replace(/\s+/g, " ").trim().slice(0, 240);
      const routeName = state.lastTaskCategory || "session-recovery";
      params.store.recordFailure(info.sessionID, "environment", routeName, `${errorType}: ${summary}`);

      await showToast({
        client: params.client,
        directory: params.directory,
        title: "oh-my-Aegis: session recovery",
        message: `Recovering from ${errorType}...`,
        variant: "warning",
      });

      await callSessionAbort(sessionClient, info.sessionID, params.directory);
      const messages = await callSessionMessages(sessionClient, info.sessionID, params.directory, 200);
      if (!messages) {
        params.notesStore.recordScan(
          `Session recovery failed: could not load messages (type=${errorType}) session=${info.sessionID}`
        );
        return;
      }

      const failed = findMessageById(messages, info.messageID);
      if (!failed) {
        params.notesStore.recordScan(
          `Session recovery failed: message not found (type=${errorType}) session=${info.sessionID} message=${info.messageID}`
        );
        return;
      }

      if (errorType === "tool_result_missing") {
        const toolUses = extractToolUses(failed.parts);
        if (toolUses.length === 0) {
          params.notesStore.recordScan(
            `Session recovery failed: no tool_use IDs found (type=${errorType}) session=${info.sessionID} message=${info.messageID}`
          );
          return;
        }
        const prefix = "[oh-my-Aegis session recovery]";
        const toolResultParts = toolUses.map((t) => {
          const toolLabel = t.name ? `tool=${t.name}` : "tool=unknown";
          const content =
            state.mode === "BOUNTY"
              ? `${prefix} Missing tool_result for tool_use_id=${t.id} (${toolLabel}). Do NOT assume it didn't run. Check scope/side-effects before rerun; prefer read-only validation.`
              : `${prefix} Missing tool_result for tool_use_id=${t.id} (${toolLabel}). Treat as cancelled and continue. Re-run only if needed.`;
          return {
            type: "tool_result",
            tool_use_id: t.id,
            content,
          };
        });
        const ok = await callSessionPromptParts(sessionClient, info.sessionID, params.directory, toolResultParts);
        params.notesStore.recordScan(
          `Session recovery tool_result_missing: injected=${toolUses.length} ok=${ok} session=${info.sessionID} message=${info.messageID}`
        );
        if (ok) {
          await showToast({
            client: params.client,
            directory: params.directory,
            title: "oh-my-Aegis: session recovered",
            message: "Injected missing tool results. Retry the last step.",
            variant: "success",
          });
        }
        return;
      }

      params.notesStore.recordScan(
        `Session recovery detected unsupported errorType=${errorType} session=${info.sessionID} message=${info.messageID}`
      );
    } finally {
      processingByMessageID.delete(info.messageID);
    }
  };

  return { isRecoverableError, handleEvent };
}
