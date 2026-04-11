import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config/loader";
import { dispatchParallel, planScanDispatch, type SessionClient } from "../src/orchestration/parallel";
import { ParallelBackgroundManager } from "../src/orchestration/parallel-background";
import { SingleWriterApplyLock } from "../src/orchestration/apply-lock";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";
import { agentModel } from "../src/orchestration/model-health";

function makeState(overrides?: Partial<SessionState>): SessionState {
  return {
    ...DEFAULT_STATE,
    mode: "CTF",
    alternatives: [],
    recentEvents: [],
    failureReasonCounts: { ...DEFAULT_STATE.failureReasonCounts },
    dispatchHealthBySubagent: {},
    modelHealthByModel: {},
    ...overrides,
  };
}

function makeMockSessionClient(opts: {
  idPrefix: string;
  statuses: Record<string, { type: string }>;
  messagesBySessionID: Record<string, string>;
}): SessionClient {
  let sessionCounter = 0;
  return {
    create: async () => {
      sessionCounter += 1;
      return { data: { id: `${opts.idPrefix}-${sessionCounter}` } };
    },
    promptAsync: async () => ({ ok: true }),
    messages: async (params: unknown) => {
      const p = params as Record<string, unknown>;
      const path = p.path as Record<string, unknown> | undefined;
      const id = (path?.id ?? p.sessionID) as unknown;
      const text = typeof id === "string" ? opts.messagesBySessionID[id] : "";
      return {
        data: text
          ? [{ role: "assistant", parts: [{ type: "text", text }] }]
          : [],
      };
    },
    abort: async () => ({ ok: true }),
    status: async () => ({ data: opts.statuses }),
    children: async () => ({ data: undefined }),
  };
}

describe("ParallelBackgroundManager", () => {
  it("marks idle tracks as completed and notifies parent", async () => {
    const config = loadConfig(tmpdir());
    const parentSessionID = `parent-bg-${Date.now()}`;
    const state = makeState({ targetType: "PWN" });
    const plan = planScanDispatch(state, config, "heap challenge");

    const prefix = `bgtest-${Date.now()}-idle`;
    const sessionClient = makeMockSessionClient({
      idPrefix: prefix,
      statuses: {
        [`${prefix}-1`]: { type: "idle" },
        [`${prefix}-2`]: { type: "idle" },
        [`${prefix}-3`]: { type: "idle" },
      },
      messagesBySessionID: {
        [`${prefix}-1`]: "scan result 1",
        [`${prefix}-2`]: "scan result 2",
        [`${prefix}-3`]: "scan result 3",
      },
    });

    const group = await dispatchParallel(sessionClient, parentSessionID, "/tmp", plan, 3, {
      parallel: {
        queue_enabled: false,
        max_concurrent_per_provider: 3,
        provider_caps: { openai: 3 },
        auto_dispatch_scan: false,
        auto_dispatch_hypothesis: false,
        bounty_scan: {
          max_tracks: 3,
          triage_tracks: 2,
          research_tracks: 1,
          scope_recheck_tracks: 0,
        },
      },
    });

    const prompts: Array<Record<string, unknown>> = [];
    const mockClient = {
      session: {
        promptAsync: async (args: unknown) => {
          prompts.push(args as Record<string, unknown>);
          return { ok: true };
        },
      },
      tui: {
        showToast: async () => ({ ok: true }),
      },
    };

    const manager = new ParallelBackgroundManager({
      client: mockClient,
      directory: "/tmp",
      config: { ...config, tui_notifications: { ...config.tui_notifications, enabled: true } },
    });
    manager.bindSessionClient(sessionClient);

    await manager.pollOnce();

    expect(group.tracks.every((t) => t.status === "completed")).toBe(true);
    expect(group.completedAt).toBeGreaterThan(0);
    expect(prompts.length).toBe(1);
    const first = prompts[0];
    const firstPath = first.path as Record<string, unknown> | undefined;
    const target = (firstPath?.id ?? first.sessionID) as unknown;
    expect(target).toBe(parentSessionID);
  });

  it("does not complete tracks when not idle", async () => {
    const config = loadConfig(tmpdir());
    const parentSessionID = `parent-bg2-${Date.now()}`;
    const state = makeState({ targetType: "WEB_API" });
    const plan = planScanDispatch(state, config, "web challenge");

    const prefix = `bgtest-${Date.now()}-run`;
    const sessionClient = makeMockSessionClient({
      idPrefix: prefix,
      statuses: {
        [`${prefix}-1`]: { type: "running" },
        [`${prefix}-2`]: { type: "running" },
      },
      messagesBySessionID: {},
    });

    const group = await dispatchParallel(sessionClient, parentSessionID, "/tmp", plan, 2);

    const prompts: Array<Record<string, unknown>> = [];
    const mockClient = {
      session: {
        promptAsync: async (args: unknown) => {
          prompts.push(args as Record<string, unknown>);
          return { ok: true };
        },
      },
    };

    const manager = new ParallelBackgroundManager({
      client: mockClient,
      directory: "/tmp",
      config,
    });
    manager.bindSessionClient(sessionClient);

    await manager.pollOnce();

    expect(group.tracks.every((t) => t.status === "running" || t.status === "pending")).toBe(true);
    expect(group.completedAt).toBe(0);
    expect(prompts.length).toBe(0);
  });

  it("fails running Gemini tracks that show zero tool-call progress for over one minute and marks the model unhealthy", async () => {
    const config = loadConfig(tmpdir());
    const parentSessionID = `parent-bg-stall-${Date.now()}`;
    const now = Date.now();
    const sessionClient: SessionClient = {
      create: async () => ({ data: { id: "stall-track-1" } }),
      promptAsync: async () => ({ ok: true }),
      messages: async () => ({
        data: [
          {
            role: "user",
            parts: [{ type: "text", text: "start track" }],
          },
        ],
      }),
      abort: async () => ({ ok: true }),
      status: async () => ({ data: { "stall-track-1": { type: "running" } } }),
      children: async () => ({ data: undefined }),
    };

    const group = await dispatchParallel(
      sessionClient,
      parentSessionID,
      "/tmp",
      {
        label: "gemini-stall",
        tracks: [{ purpose: "explore", agent: "ctf-explore", prompt: "explore target" }],
      },
      1,
    );
    group.tracks[0]!.createdAt = now - 61_000;

    const marked: Array<{ sessionID: string; modelId: string; reason: string }> = [];
    const manager = new ParallelBackgroundManager({
      client: {},
      directory: "/tmp",
      config,
      now: () => now,
      stalledTrackMs: 60_000,
      store: {
        markModelUnhealthy(sessionID, modelId, reason) {
          marked.push({ sessionID, modelId, reason });
          return makeState();
        },
      },
    });
    manager.bindSessionClient(sessionClient);

    await manager.pollOnce();

    expect(group.tracks[0]?.status).toBe("failed");
    expect(group.tracks[0]?.lastActivity).toBe("stalled_without_tool_calls");
    expect(group.tracks[0]?.result).toContain("without tool calls");
    expect(marked).toEqual([
      {
        sessionID: parentSessionID,
        modelId: agentModel("ctf-explore") ?? "",
        reason: "parallel_zero_tool_call_stall",
      },
    ]);
  });

  it("does not fail a long-running track when tool activity is present", async () => {
    const config = loadConfig(tmpdir());
    const parentSessionID = `parent-bg-stall-tool-${Date.now()}`;
    const now = Date.now();
    const sessionClient: SessionClient = {
      create: async () => ({ data: { id: "stall-track-tool-1" } }),
      promptAsync: async () => ({ ok: true }),
      messages: async () => ({
        data: [
          {
            role: "user",
            parts: [{ type: "text", text: "start track" }],
          },
          {
            role: "tool",
            parts: [{ type: "text", text: "tool executed" }],
          },
        ],
      }),
      abort: async () => ({ ok: true }),
      status: async () => ({ data: { "stall-track-tool-1": { type: "running" } } }),
      children: async () => ({ data: undefined }),
    };

    const group = await dispatchParallel(
      sessionClient,
      parentSessionID,
      "/tmp",
      {
        label: "gemini-stall-with-tool",
        tracks: [{ purpose: "explore", agent: "ctf-explore", prompt: "explore target" }],
      },
      1,
    );
    group.tracks[0]!.createdAt = now - 61_000;

    let markedCount = 0;
    const manager = new ParallelBackgroundManager({
      client: {},
      directory: "/tmp",
      config,
      now: () => now,
      stalledTrackMs: 60_000,
      store: {
        markModelUnhealthy() {
          markedCount += 1;
          return makeState();
        },
      },
    });
    manager.bindSessionClient(sessionClient);

    await manager.pollOnce();

    expect(group.tracks[0]?.status).toBe("running");
    expect(group.tracks[0]?.completedAt).toBe(0);
    expect(markedCount).toBe(0);
  });

  it("recovers stale lock with explicit audit metadata", async () => {
    const root = join(tmpdir(), `aegis-stale-lock-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const lockDir = join(root, ".Aegis", "runs", "locks");
    const lockPath = join(lockDir, "single-writer-apply.lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        version: 1,
        holder: {
          pid: 99_999_999,
          sessionID: "stale-owner",
          acquiredAtMs: 1_000,
        },
        stalePolicy: {
          staleAfterMs: 500,
        },
        audit: {
          acquiredAtMs: 1_000,
          recovered: false,
        },
      })}\n`,
      "utf-8",
    );

    try {
      const lock = new SingleWriterApplyLock({
        projectDir: root,
        sessionID: "fresh-owner",
        pid: 444,
        staleAfterMs: 500,
        now: () => 2_000,
      });

      const recovered = await lock.withLock(async () => "recovered");
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) {
        throw new Error("expected stale lock recovery to succeed");
      }
      expect(recovered.audit.recovered).toBe(true);
      expect(recovered.audit.recoveredFrom?.sessionID).toBe("stale-owner");
      expect(recovered.audit.recoveredFrom?.pid).toBe(99_999_999);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
