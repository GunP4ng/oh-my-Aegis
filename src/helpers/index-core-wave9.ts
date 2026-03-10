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

const LOOP_GUARD_TOOLS = new Set(["task", "todowrite", "ctf_orch_event"]);
const LOOP_GUARD_REPEAT_THRESHOLD = 3;
const LOOP_GUARD_WINDOW = 5;

export const stableActionSignature = (
  toolName: string,
  args: unknown,
  deps: {
    isRecord: IsRecord;
    hashAction: (input: string) => string;
  }
): string => {
  const { isRecord, hashAction } = deps;
  const normalizedArgs = (() => {
    if (!isRecord(args)) {
      return args ?? {};
    }

    if (toolName === "task") {
      return {
        category: typeof args.category === "string" ? args.category.trim().toLowerCase() : "",
        subagent_type: typeof args.subagent_type === "string" ? args.subagent_type.trim().toLowerCase() : "",
        session_id: typeof args.session_id === "string" ? args.session_id.trim().toLowerCase() : "",
      };
    }

    if (toolName === "todowrite") {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      return {
        count: todos.length,
        statuses: todos.map((todo) =>
          isRecord(todo) && typeof todo.status === "string" ? todo.status.trim().toLowerCase() : "pending"
        ),
        priorities: todos.map((todo) =>
          isRecord(todo) && typeof todo.priority === "string" ? todo.priority.trim().toLowerCase() : "medium"
        ),
      };
    }

    if (toolName === "ctf_orch_event") {
      return {
        event: typeof args.event === "string" ? args.event.trim().toLowerCase() : "",
        failure_reason: typeof args.failure_reason === "string" ? args.failure_reason.trim().toLowerCase() : "",
        failed_route: typeof args.failed_route === "string" ? args.failed_route.trim().toLowerCase() : "",
        target_type: typeof args.target_type === "string" ? args.target_type.trim().toLowerCase() : "",
      };
    }

    return args;
  })();

  const payload = JSON.stringify(normalizedArgs, (_key, value) => {
    if (typeof value === "function") {
      return undefined;
    }
    return value;
  });
  const digest = hashAction(`${toolName}:${payload}`);
  return `${toolName}:${digest}`;
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
