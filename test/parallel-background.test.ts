import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config/loader";
import { dispatchParallel, planScanDispatch, type SessionClient } from "../src/orchestration/parallel";
import { ParallelBackgroundManager } from "../src/orchestration/parallel-background";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";

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

    const group = await dispatchParallel(sessionClient, parentSessionID, "/tmp", plan, 3);

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
});
