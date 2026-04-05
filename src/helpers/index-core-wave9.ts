import type { AegisTodoEntry } from "../state/types";

type IsRecord = (value: unknown) => value is Record<string, unknown>;

type LoopGuardState = {
  loopGuard: {
    recentActionSignatures: string[];
    blockedActionSignature: string;
    blockedReason: string;
  };
  timeoutFailCount: number;
  samePayloadLoops: number;
};

type SharedChannelMessage = {
  seq: number;
  from: string;
  to?: string;
  kind: string;
  summary: string;
  refs: string[];
};

const LOOP_GUARD_TOOLS = new Set(["task"]);
const LOOP_GUARD_BOOKKEEPING_TOOLS = new Set(["todowrite", "ctf_orch_event"]);
const LOOP_GUARD_REPEAT_THRESHOLD = 3;
const LOOP_GUARD_WINDOW = 5;
const normalizeLoopGuardField = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
};

const normalizeFailureClass = (value: unknown): string => {
  const normalized = normalizeLoopGuardField(value);
  if (!normalized) {
    return "none";
  }
  const collapsed = normalized.replace(/\s+/g, "_");
  const colonIndex = collapsed.indexOf(":");
  return colonIndex >= 0 ? collapsed.slice(0, colonIndex) : collapsed;
};

export const stableActionSignature = (
  toolName: string,
  args: unknown,
  deps: {
    isRecord: IsRecord;
    hashAction: (input: string) => string;
  }
): string => {
  const { isRecord, hashAction } = deps;
  const meta = isRecord(args) && isRecord(args.__aegis_meta) ? args.__aegis_meta : null;
  const metaRoute = normalizeLoopGuardField(meta?.route) || "unknown_route";
  const metaFailure = normalizeFailureClass(meta?.failure_class);
  const normalizedTool = normalizeLoopGuardField(toolName) || "unknown_tool";
  const baseArgs = (() => {
    if (!isRecord(args)) {
      return args ?? {};
    }
    const { __aegis_meta: _ignored, ...rest } = args;
    return rest;
  })();
  const payloadFingerprint = hashAction(
    JSON.stringify(baseArgs, (_key, value) => {
      if (typeof value === "function") {
        return undefined;
      }
      return value;
    })
  );
  const signaturePayload = `${metaRoute}:${normalizedTool}:${metaFailure}:${payloadFingerprint}`;
  const digest = hashAction(signaturePayload);
  return `${normalizedTool}:${digest}`;
};

export const applyLoopGuard = (params: {
  sessionID: string;
  toolName: string;
  args: unknown;
  stuckThreshold: number;
  getState: (sessionID: string) => LoopGuardState;
  setLoopGuardBlock: (sessionID: string, signature: string, reason: string) => void;
  recordActionSignature: (sessionID: string, signature: string) => void;
  stableActionSignature: (toolName: string, args: unknown) => string;
  createPolicyDenyError: (message: string) => Error;
}): void => {
  const {
    sessionID,
    toolName,
    args,
    stuckThreshold,
    getState,
    setLoopGuardBlock,
    recordActionSignature,
    stableActionSignature,
    createPolicyDenyError,
  } = params;

  if (LOOP_GUARD_BOOKKEEPING_TOOLS.has(toolName)) {
    return;
  }

  if (!LOOP_GUARD_TOOLS.has(toolName)) {
    return;
  }

  const loopState = getState(sessionID);
  const signature = stableActionSignature(toolName, args);
  const recent = loopState.loopGuard.recentActionSignatures.slice(-LOOP_GUARD_WINDOW);
  const repeatCount = recent.filter((item) => item === signature).length;
  const shouldBlockRepeatedAction =
    loopState.loopGuard.blockedActionSignature === signature ||
    (repeatCount >= LOOP_GUARD_REPEAT_THRESHOLD - 1 &&
      (loopState.timeoutFailCount >= 2 || loopState.samePayloadLoops >= stuckThreshold));

  if (shouldBlockRepeatedAction) {
    const reason =
      loopState.loopGuard.blockedReason ||
      `Blocked repeated ${toolName} dispatch after timeout/stall spiral. Choose a different tool or summarize the blocker.`;
    setLoopGuardBlock(sessionID, signature, reason);
    throw createPolicyDenyError(`[oh-my-Aegis loop-guard] ${reason}`);
  }

  recordActionSignature(sessionID, signature);
};

export const normalizeTodoEntry = (todo: unknown, index: number, isRecord: IsRecord): AegisTodoEntry | null => {
  if (!isRecord(todo)) {
    return null;
  }
  const content = typeof todo.content === "string" ? todo.content.trim() : "";
  if (!content) {
    return null;
  }
  const rawStatus = typeof todo.status === "string" ? todo.status : "pending";
  const status =
    rawStatus === "in_progress" || rawStatus === "completed" || rawStatus === "cancelled" ? rawStatus : "pending";
  const rawResolution = typeof todo.resolution === "string" ? todo.resolution.trim().toLowerCase() : "";
  const contentLower = content.toLowerCase();
  const resolution =
    rawResolution === "success" || rawResolution === "failed" || rawResolution === "blocked"
      ? rawResolution
      : status === "completed"
        ? "success"
        : status === "cancelled"
          ? contentLower.includes("blocked")
            ? "blocked"
            : "failed"
          : "none";
  const id = typeof todo.id === "string" && todo.id.trim().length > 0 ? todo.id.trim() : `todo-${index + 1}`;
  const priority = typeof todo.priority === "string" && todo.priority.trim().length > 0 ? todo.priority.trim() : "medium";
  return {
    id,
    content,
    status,
    priority,
    resolution,
  };
};

export const normalizeTodoEntries = (todos: unknown[], isRecord: IsRecord): AegisTodoEntry[] => {
  return todos
    .map((todo, index) => normalizeTodoEntry(todo, index, isRecord))
    .filter((todo): todo is AegisTodoEntry => todo !== null);
};

export const buildSharedChannelPrompt = (
  sessionID: string,
  subagentType: string,
  readSharedMessages: (sessionID: string, channelID: string, sinceSeq: number, limit: number) => SharedChannelMessage[]
): string => {
  const relevant = readSharedMessages(sessionID, "shared", 0, 8)
    .filter((message) => !message.to || message.to === "all" || message.to === subagentType || message.to === "broadcast")
    .slice(-5);
  if (relevant.length === 0) {
    return "";
  }
  const lines = ["[oh-my-Aegis shared-channel]"];
  for (const message of relevant) {
    const target = message.to ? ` -> ${message.to}` : "";
    const refs = message.refs.length > 0 ? ` refs=${message.refs.join(",")}` : "";
    lines.push(`- #${message.seq} ${message.from}${target} [${message.kind}] ${message.summary}${refs}`);
  }
  return lines.join("\n");
};
