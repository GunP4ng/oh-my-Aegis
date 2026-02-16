import type { OrchestratorConfig } from "../config/schema";
import {
  dispatchQueuedTracks,
  getAllGroups,
  type ParallelGroup,
  type ParallelTrack,
  type SessionClient,
} from "./parallel";

type ToastVariant = "info" | "success" | "warning" | "error";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TRACK_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MESSAGE_LIMIT = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasError(result: unknown): boolean {
  if (!isRecord(result)) return false;
  return Boolean(result.error);
}

function getGroupKey(group: ParallelGroup): string {
  return `${group.parentSessionID}:${group.createdAt}:${group.label}`;
}

function extractStatusMap(statusResult: unknown): Record<string, { type?: string }> {
  if (!statusResult) return {};
  if (hasError(statusResult)) return {};
  if (isRecord(statusResult) && isRecord(statusResult.data)) {
    return statusResult.data as Record<string, { type?: string }>;
  }
  if (isRecord(statusResult)) {
    return statusResult as Record<string, { type?: string }>;
  }
  return {};
}

async function callSessionStatusMap(sessionClient: SessionClient, directory: string): Promise<Record<string, { type?: string }>> {
  try {
    const primary = await sessionClient.status({ query: { directory } });
    return extractStatusMap(primary);
  } catch (error) {
    void error;
  }

  try {
    const fallback = await sessionClient.status({ directory });
    return extractStatusMap(fallback);
  } catch (error) {
    void error;
  }

  try {
    const last = await sessionClient.status();
    return extractStatusMap(last);
  } catch (error) {
    void error;
    return {};
  }
}

async function callSessionMessagesData(
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
    if (!hasError(primary) && Array.isArray((primary as any)?.data)) return (primary as any).data as unknown[];
  } catch (error) {
    void error;
  }

  try {
    const fallback = await sessionClient.messages({ sessionID, directory, limit });
    if (!hasError(fallback) && Array.isArray((fallback as any)?.data)) return (fallback as any).data as unknown[];
  } catch (error) {
    void error;
  }

  return null;
}

function extractLastAssistantText(messages: unknown[]): string {
  let lastAssistant = "";
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    const role =
      typeof msg.role === "string"
        ? msg.role
        : isRecord(msg.info) && typeof msg.info.role === "string"
          ? String(msg.info.role)
          : "";
    if (role !== "assistant") continue;

    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    const text = parts
      .map((p: unknown) => (isRecord(p) && typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("\n");
    if (text) lastAssistant = text;
  }
  return lastAssistant;
}

function countGroupStatuses(group: ParallelGroup): { completed: number; failed: number; aborted: number; total: number } {
  let completed = 0;
  let failed = 0;
  let aborted = 0;
  for (const t of group.tracks) {
    if (t.status === "completed") completed += 1;
    if (t.status === "failed") failed += 1;
    if (t.status === "aborted") aborted += 1;
  }
  return { completed, failed, aborted, total: group.tracks.length + group.queue.length };
}

function hasRunningTracks(group: ParallelGroup): boolean {
  if (group.queue.length > 0) return true;
  return group.tracks.some((t) => t.status === "running" || t.status === "pending");
}

function isGroupDone(group: ParallelGroup): boolean {
  if (group.queue.length > 0) return false;
  return group.tracks.every((t) => t.status === "completed" || t.status === "failed" || t.status === "aborted");
}

export class ParallelBackgroundManager {
  private sessionClient: SessionClient | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | undefined;
  private pollInFlight = false;
  private notifiedGroupKeys = new Set<string>();

  constructor(
    private readonly params: {
      client: unknown;
      directory: string;
      config: OrchestratorConfig;
      pollIntervalMs?: number;
      trackTtlMs?: number;
    },
  ) {}

  bindSessionClient(sessionClient: SessionClient): void {
    this.sessionClient = sessionClient;
  }

  ensurePolling(): void {
    if (!this.sessionClient) return;
    if (this.pollingInterval) return;
    if (!this.hasAnyRunningTracks()) return;

    const intervalMs = this.params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollingInterval = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
    (this.pollingInterval as any)?.unref?.();
  }

  stopPolling(): void {
    if (!this.pollingInterval) return;
    clearInterval(this.pollingInterval);
    this.pollingInterval = undefined;
  }

  handleEvent(type: string, props: Record<string, unknown>): void {
    if (!type) return;
    if (!this.sessionClient) return;
    if (type === "session.idle") {
      const sessionID = typeof props.sessionID === "string" ? props.sessionID : "";
      if (sessionID) {
        void this.pollOnce();
      }
    }
    if (type === "session.status") {
      const sessionID = typeof props.sessionID === "string" ? props.sessionID : "";
      const status = props.status as { type?: string } | undefined;
      if (sessionID && status?.type === "idle") {
        void this.pollOnce();
      }
    }

    if (type === "session.deleted") {
      const info = props.info;
      const deletedID = isRecord(info) && typeof info.id === "string" ? info.id : "";
      if (!deletedID) return;
      this.markSessionDeleted(deletedID);
      void this.pollOnce();
    }
  }

  private markSessionDeleted(sessionID: string): void {
    const now = Date.now();
    for (const groups of getAllGroups().values()) {
      for (const group of groups) {
        for (const track of group.tracks) {
          if (track.sessionID !== sessionID) continue;
          if (track.status === "completed" || track.status === "failed" || track.status === "aborted") {
            continue;
          }
          track.status = "aborted";
          track.result = track.result || "Session deleted";
          track.completedAt = now;
        }
        if (group.completedAt === 0 && isGroupDone(group)) {
          group.completedAt = now;
        }
      }
    }
  }

  async pollOnce(): Promise<void> {
    if (!this.sessionClient) return;
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      await this.pollOnceInner(this.sessionClient);
    } finally {
      this.pollInFlight = false;
    }
  }

  private hasAnyRunningTracks(): boolean {
    for (const groups of getAllGroups().values()) {
      for (const g of groups) {
        if (g.completedAt > 0) continue;
        if (hasRunningTracks(g)) return true;
      }
    }
    return false;
  }

  private pruneStaleTracks(now: number): void {
    const ttlMs = this.params.trackTtlMs ?? DEFAULT_TRACK_TTL_MS;
    for (const groups of getAllGroups().values()) {
      for (const group of groups) {
        for (const track of group.tracks) {
          if (track.status !== "running" && track.status !== "pending") continue;
          const age = now - track.createdAt;
          if (age <= ttlMs) continue;
          track.status = "failed";
          track.result = track.result || "Timed out while running parallel track";
          track.completedAt = now;
        }
        if (group.completedAt === 0 && isGroupDone(group)) {
          group.completedAt = now;
        }
      }
    }
  }

  private async pollOnceInner(sessionClient: SessionClient): Promise<void> {
    const now = Date.now();
    this.pruneStaleTracks(now);

    if (!this.hasAnyRunningTracks()) {
      this.stopPolling();
      return;
    }

    const directory = this.params.directory;
    const statusMap = await callSessionStatusMap(sessionClient, directory);
    const idleSessionIDs = new Set<string>();

    for (const groups of getAllGroups().values()) {
      for (const group of groups) {
        if (group.completedAt > 0) continue;
        for (const track of group.tracks) {
          if (!track.sessionID) continue;
          if (track.status !== "running" && track.status !== "pending") continue;
          const status = statusMap[track.sessionID];
          if (status?.type === "idle") {
            idleSessionIDs.add(track.sessionID);
          }
        }
      }
    }

    for (const groups of getAllGroups().values()) {
      for (const group of groups) {
        if (group.completedAt > 0) continue;
        await this.updateGroupFromIdle(sessionClient, group, idleSessionIDs);
        await dispatchQueuedTracks(sessionClient, group, directory);
        if (group.completedAt === 0 && isGroupDone(group)) {
          group.completedAt = Date.now();
        }
        if (group.completedAt > 0) {
          await this.notifyGroupCompleted(group);
        }
      }
    }

    if (!this.hasAnyRunningTracks()) {
      this.stopPolling();
    }
  }

  private async updateGroupFromIdle(
    sessionClient: SessionClient,
    group: ParallelGroup,
    idleSessionIDs: Set<string>,
  ): Promise<void> {
    const directory = this.params.directory;
    for (const track of group.tracks) {
      if (!track.sessionID) continue;
      if (track.status !== "running" && track.status !== "pending") continue;
      if (!idleSessionIDs.has(track.sessionID)) continue;

      try {
        const data = await callSessionMessagesData(
          sessionClient,
          track.sessionID,
          directory,
          DEFAULT_MESSAGE_LIMIT,
        );
        const lastAssistant = Array.isArray(data) ? extractLastAssistantText(data) : "";
        if (lastAssistant) {
          track.result = lastAssistant.slice(0, 2000);
          track.status = "completed";
          track.completedAt = Date.now();
        } else {
          track.result = track.result || "(idle; no assistant text message found)";
          track.status = "completed";
          track.completedAt = Date.now();
        }
      } catch (error) {
        track.status = "failed";
        track.result = `Collection error: ${error instanceof Error ? error.message : String(error)}`;
        track.completedAt = Date.now();
      }
    }
  }

  private async notifyGroupCompleted(group: ParallelGroup): Promise<void> {
    const key = getGroupKey(group);
    if (this.notifiedGroupKeys.has(key)) return;
    this.notifiedGroupKeys.add(key);

    const counts = countGroupStatuses(group);
    const title = "oh-my-Aegis: parallel complete";
    const message = `${group.label} (${counts.completed} ok, ${counts.failed} fail, ${counts.aborted} aborted). Use ctf_parallel_collect.`;
    const text = [
      "[oh-my-Aegis parallel]",
      `group=${group.label}`,
      `tracks=${counts.total} completed=${counts.completed} failed=${counts.failed} aborted=${counts.aborted}`,
      "Next:",
      "- ctf_parallel_collect message_limit=5",
    ].join("\n");

    await this.maybeShowToast(title, message, "success");
    await this.maybePromptParent(group.parentSessionID, text);
  }

  private async maybeShowToast(
    title: string,
    message: string,
    variant: ToastVariant,
  ): Promise<void> {
    if (!this.params.config.tui_notifications.enabled) return;
    const toastFn = (this.params.client as any)?.tui?.showToast;
    if (typeof toastFn !== "function") return;

    const duration = 5_000;
    try {
      await toastFn({
        directory: this.params.directory,
        title,
        message,
        variant,
        duration,
      });
      return;
    } catch (error) {
      void error;
    }

    try {
      await toastFn({
        query: { directory: this.params.directory },
        body: {
          title,
          message,
          variant,
          duration,
        },
      });
    } catch (error) {
      void error;
    }
  }

  private async maybePromptParent(sessionID: string, text: string): Promise<void> {
    const session = (this.params.client as any)?.session;
    const promptAsync = session?.promptAsync;
    if (typeof promptAsync !== "function") return;

    const parts = [
      {
        type: "text",
        text,
        synthetic: true,
        metadata: {
          source: "oh-my-Aegis.parallel",
        },
      },
    ];

    try {
      await promptAsync({
        path: { id: sessionID },
        query: { directory: this.params.directory },
        body: { parts },
      });
      return;
    } catch (error) {
      void error;
    }

    try {
      await promptAsync({
        sessionID,
        directory: this.params.directory,
        parts,
      });
    } catch (error) {
      void error;
    }
  }
}

export function isTrackRunnable(track: ParallelTrack): boolean {
  return track.status === "running" || track.status === "pending";
}
