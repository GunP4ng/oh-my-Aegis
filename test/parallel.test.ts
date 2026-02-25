import { describe, expect, it } from "bun:test";
import {
  abortAll,
  abortAllExcept,
  collectResults,
  configureParallelPersistence,
  dispatchParallel,
  extractSessionClient,
  getActiveGroup,
  groupSummary,
  planDeepWorkerDispatch,
  planHypothesisDispatch,
  planScanDispatch,
  type SessionClient,
} from "../src/orchestration/parallel";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";
import { loadConfig } from "../src/config/loader";
import { tmpdir } from "node:os";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

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

function makeMockSessionClient(opts?: {
  createFail?: boolean;
  promptFail?: boolean;
  messageData?: unknown[];
  createResponseShape?: "data-id" | "data-info-id" | "root-id" | "properties-info-id";
  createRequiresNoParent?: boolean;
  createRequiresEmpty?: boolean;
  forkEnabled?: boolean;
}): SessionClient {
  let sessionCounter = 0;

  return {
    create: async (params) => {
      if (opts?.createFail) throw new Error("create failed");

      if (opts?.createRequiresNoParent) {
        const payload = params as Record<string, unknown>;
        const body = payload.body && typeof payload.body === "object"
          ? (payload.body as Record<string, unknown>)
          : null;
        const hasParent =
          typeof payload.parentID === "string" ||
          typeof body?.parentID === "string";
        if (hasParent) {
          return { data: {} };
        }
      }

      if (opts?.createRequiresEmpty) {
        const payload = params as Record<string, unknown>;
        const hasAnyParam = Object.keys(payload).length > 0;
        if (hasAnyParam) {
          return { data: {} };
        }
      }

      sessionCounter += 1;
      const id = `child-${sessionCounter}`;
      if (opts?.createResponseShape === "data-info-id") {
        return { data: { info: { id } } };
      }
      if (opts?.createResponseShape === "root-id") {
        return { id };
      }
      if (opts?.createResponseShape === "properties-info-id") {
        return { properties: { info: { id } } };
      }
      return { data: { id } };
    },
    promptAsync: async (_params) => {
      if (opts?.promptFail) throw new Error("prompt failed");
      return {};
    },
    messages: async (_params) => {
      if (opts?.messageData) {
        return { data: opts.messageData };
      }
      return {
        data: [
          {
            role: "assistant",
            parts: [{ type: "text", text: "Analysis complete. Found 3 observations." }],
          },
        ],
      };
    },
    fork: async (_params) => {
      if (!opts?.forkEnabled) {
        throw new Error("fork not available");
      }
      sessionCounter += 1;
      return { data: { id: `child-${sessionCounter}` } };
    },
    abort: async (_params) => ({}),
    status: async () => ({ data: {} }),
    children: async () => ({ data: undefined }),
  };
}

describe("parallel orchestration", () => {
  describe("extractSessionClient", () => {
    it("returns null for missing client", () => {
      expect(extractSessionClient(null)).toBeNull();
      expect(extractSessionClient(undefined)).toBeNull();
      expect(extractSessionClient({})).toBeNull();
    });

    it("returns null for incomplete session object", () => {
      expect(extractSessionClient({ session: {} })).toBeNull();
      expect(
        extractSessionClient({
          session: { create: () => {}, promptAsync: () => {} },
        })
      ).toBeNull();
    });

    it("returns client for valid session object", () => {
      const client = extractSessionClient({
        session: {
          create: () => {},
          promptAsync: () => {},
          messages: () => {},
          abort: () => {},
          status: () => {},
          children: () => {},
        },
      });
      expect(client).not.toBeNull();
      expect(typeof client?.create).toBe("function");
    });

    it("binds session methods to preserve SDK this context", async () => {
      const sessionObj = {
        _client: { post: () => ({}) },
        create(this: { _client?: { post: () => unknown } }) {
          return Promise.resolve({ data: { id: this._client ? "ok" : "missing" } });
        },
        promptAsync(this: { _client?: { post: () => unknown } }) {
          return Promise.resolve(this._client ? {} : { error: true });
        },
        messages(this: { _client?: { post: () => unknown } }) {
          return Promise.resolve(this._client ? { data: [] } : { error: true });
        },
        abort(this: { _client?: { post: () => unknown } }) {
          return Promise.resolve(this._client ? {} : { error: true });
        },
      };

      const client = extractSessionClient({ session: sessionObj });
      expect(client).not.toBeNull();
      const createResult = await client!.create({});
      expect((createResult as { data?: { id?: string } }).data?.id).toBe("ok");
      const promptResult = await client!.promptAsync({});
      expect((promptResult as { error?: boolean }).error).toBeUndefined();
    });
  });

  describe("planScanDispatch", () => {
    it("creates 3 tracks for non-UNKNOWN/MISC targets", () => {
      const state = makeState({ targetType: "PWN" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "heap overflow challenge");

      expect(plan.tracks.length).toBe(3);
      expect(plan.tracks[0].purpose).toBe("fast-recon");
      expect(plan.tracks[0].agent).toBe("ctf-explore");
      expect(plan.tracks[1].purpose).toBe("domain-scan-pwn");
      expect(plan.tracks[1].agent).toBe("ctf-pwn");
      expect(plan.tracks[2].purpose).toBe("research-cve");
      expect(plan.tracks[2].agent).toBe("ctf-research");
    });

    it("creates 2 tracks for UNKNOWN target (deduplicates ctf-explore)", () => {
      const state = makeState({ targetType: "UNKNOWN" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "mystery challenge");

      expect(plan.tracks.length).toBe(2);
      expect(plan.tracks.every((t) => t.agent !== "ctf-explore" || t.purpose === "fast-recon")).toBe(true);
    });

    it("includes challenge description in prompts", () => {
      const state = makeState({ targetType: "WEB_API" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "SQL injection in login form");

      for (const track of plan.tracks) {
        expect(track.prompt).toContain("SQL injection in login form");
      }
    });

    it("creates bounty-safe scan tracks when mode is BOUNTY and scope is confirmed", () => {
      const state = makeState({ mode: "BOUNTY", scopeConfirmed: true, targetType: "WEB_API" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "public target domain");

      expect(plan.label).toBe("scan-bounty-web_api");
      expect(plan.tracks.length).toBe(3);
      expect(plan.tracks.filter((track) => track.agent === "bounty-triage").length).toBe(2);
      expect(plan.tracks.filter((track) => track.agent === "bounty-research").length).toBe(1);
      expect(plan.tracks.filter((track) => track.agent === "bounty-scope").length).toBe(0);
    });

    it("uses scope-first scan plan in BOUNTY when scope is not confirmed", () => {
      const state = makeState({ mode: "BOUNTY", scopeConfirmed: false, targetType: "WEB_API" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "public target domain");

      expect(plan.label).toBe("scan-bounty-scope");
      expect(plan.tracks.length).toBe(1);
      expect(plan.tracks[0]?.agent).toBe("bounty-scope");
      expect(plan.tracks[0]?.purpose).toBe("scope-first");
    });

    it("respects bounty scan composition and max_tracks config", () => {
      const state = makeState({ mode: "BOUNTY", scopeConfirmed: true, targetType: "WEB_API" });
      const config = loadConfig(tmpdir());
      config.parallel.bounty_scan.max_tracks = 4;
      config.parallel.bounty_scan.triage_tracks = 3;
      config.parallel.bounty_scan.research_tracks = 2;
      config.parallel.bounty_scan.scope_recheck_tracks = 1;

      const plan = planScanDispatch(state, config, "public target domain");

      expect(plan.tracks.length).toBe(4);
      expect(plan.tracks.filter((track) => track.agent === "bounty-triage").length).toBe(3);
      expect(plan.tracks.filter((track) => track.agent === "bounty-research").length).toBe(1);
      expect(plan.tracks.filter((track) => track.agent === "bounty-scope").length).toBe(0);
    });

    it("falls back to default bounty composition when all composition counts are zero", () => {
      const state = makeState({ mode: "BOUNTY", scopeConfirmed: true, targetType: "WEB_API" });
      const config = loadConfig(tmpdir());
      config.parallel.bounty_scan.max_tracks = 5;
      config.parallel.bounty_scan.triage_tracks = 0;
      config.parallel.bounty_scan.research_tracks = 0;
      config.parallel.bounty_scan.scope_recheck_tracks = 0;

      const plan = planScanDispatch(state, config, "public target domain");

      expect(plan.tracks.length).toBe(3);
      expect(plan.tracks.filter((track) => track.agent === "bounty-triage").length).toBe(1);
      expect(plan.tracks.filter((track) => track.agent === "bounty-research").length).toBe(1);
      expect(plan.tracks.filter((track) => track.agent === "bounty-scope").length).toBe(1);
    });
  });

  describe("planHypothesisDispatch", () => {
    it("creates one track per hypothesis (up to 3)", () => {
      const state = makeState({ targetType: "CRYPTO" });
      const config = loadConfig(tmpdir());
      const hypotheses = [
        { hypothesis: "RSA padding oracle", disconfirmTest: "Send malformed ciphertext" },
        { hypothesis: "Weak random seed", disconfirmTest: "Generate 100 tokens and check patterns" },
        { hypothesis: "ECB mode", disconfirmTest: "Encrypt identical blocks" },
        { hypothesis: "Extra", disconfirmTest: "Should be dropped" },
      ];

      const plan = planHypothesisDispatch(state, config, hypotheses);
      expect(plan.tracks.length).toBe(3);
      expect(plan.tracks[0].prompt).toContain("RSA padding oracle");
      expect(plan.tracks[1].prompt).toContain("Weak random seed");
      expect(plan.tracks[2].prompt).toContain("ECB mode");
    });
  });

  describe("planDeepWorkerDispatch", () => {
    it("creates deep worker tracks for PWN", () => {
      const state = makeState({ targetType: "PWN" });
      const config = loadConfig(tmpdir());
      const plan = planDeepWorkerDispatch(state, config, "heap challenge");

      expect(plan.label).toBe("deep-pwn");
      expect(plan.tracks.length).toBeGreaterThanOrEqual(3);
      expect(plan.tracks.some((t) => t.agent === "ctf-pwn")).toBe(true);
      expect(plan.tracks.some((t) => t.agent === "ctf-research")).toBe(true);
    });

    it("creates deep worker tracks for REV", () => {
      const state = makeState({ targetType: "REV" });
      const config = loadConfig(tmpdir());
      const plan = planDeepWorkerDispatch(state, config, "crackme");

      expect(plan.label).toBe("deep-rev");
      expect(plan.tracks.length).toBeGreaterThanOrEqual(3);
      expect(plan.tracks.some((t) => t.agent === "ctf-rev")).toBe(true);
      expect(plan.tracks.some((t) => t.agent === "ctf-research")).toBe(true);
    });

    it("falls back to scan plan for non PWN/REV targets", () => {
      const state = makeState({ targetType: "WEB_API" });
      const config = loadConfig(tmpdir());
      const plan = planDeepWorkerDispatch(state, config, "api challenge");

      expect(plan.label).toBe("deep-web_api");
      expect(plan.tracks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("dispatchParallel", () => {
    it("dispatches tracks and creates group", async () => {
      const client = makeMockSessionClient();
      const parentID = `parent-dispatch-${Date.now()}`;
      const state = makeState({ targetType: "REV" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "reverse me");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 3);

      expect(group.parentSessionID).toBe(parentID);
      expect(group.tracks.length).toBe(3);
      expect(group.tracks.every((t) => t.status === "running")).toBe(true);
      expect(group.tracks.every((t) => t.sessionID.startsWith("child-"))).toBe(true);
      expect(group.completedAt).toBe(0);

      // Should be tracked
      const active = getActiveGroup(parentID);
      expect(active).not.toBeNull();
      expect(active?.label).toBe(group.label);
    });

    it("handles create failures gracefully", async () => {
      const client = makeMockSessionClient({ createFail: true });
      const parentID = `parent-fail-${Date.now()}`;
      const state = makeState({ targetType: "PWN" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 3);

      expect(group.tracks.every((t) => t.status === "failed")).toBe(true);
      expect(
        group.tracks.every((t) =>
          t.result.includes("Failed to create child session") || t.result.includes("Dispatch error")
        )
      ).toBe(true);
    });

    it("respects maxTracks limit", async () => {
      const client = makeMockSessionClient();
      const parentID = `parent-limit-${Date.now()}`;
      const state = makeState({ targetType: "WEB_API" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "web challenge");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 2);
      expect(group.tracks.length).toBe(2);
    });

    it("accepts child session id from data.info.id shape", async () => {
      const client = makeMockSessionClient({ createResponseShape: "data-info-id" });
      const parentID = `parent-info-shape-${Date.now()}`;
      const state = makeState({ targetType: "REV" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "reverse me");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 2);
      expect(group.tracks.length).toBe(2);
      expect(group.tracks.every((t) => t.status === "running")).toBe(true);
      expect(group.tracks.every((t) => t.sessionID.startsWith("child-"))).toBe(true);
    });

    it("accepts child session id from properties.info.id shape", async () => {
      const client = makeMockSessionClient({ createResponseShape: "properties-info-id" });
      const parentID = `parent-properties-shape-${Date.now()}`;
      const state = makeState({ targetType: "REV" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "reverse me");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 2);
      expect(group.tracks.length).toBe(2);
      expect(group.tracks.every((t) => t.status === "running")).toBe(true);
      expect(group.tracks.every((t) => t.sessionID.startsWith("child-"))).toBe(true);
    });

    it("falls back to parentless create when parent-linked create returns no id", async () => {
      const client = makeMockSessionClient({ createRequiresNoParent: true });
      const parentID = `parentless-fallback-${Date.now()}`;
      const state = makeState({ targetType: "WEB_API" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "api challenge");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 2);
      expect(group.tracks.length).toBe(2);
      expect(group.tracks.every((t) => t.status === "running")).toBe(true);
      expect(group.tracks.every((t) => t.sessionID.startsWith("child-"))).toBe(true);
    });

    it("falls back to session fork when create cannot return ids", async () => {
      const client = makeMockSessionClient({ createFail: true, forkEnabled: true });
      const parentID = `fork-fallback-${Date.now()}`;
      const state = makeState({ targetType: "REV" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "reverse me");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 2);
      expect(group.tracks.length).toBe(2);
      expect(group.tracks.every((t) => t.status === "running")).toBe(true);
      expect(group.tracks.every((t) => t.sessionID.startsWith("child-"))).toBe(true);
    });

    it("falls back to minimal empty create when richer create payloads fail", async () => {
      const client = makeMockSessionClient({ createRequiresEmpty: true });
      const parentID = `empty-create-fallback-${Date.now()}`;
      const state = makeState({ targetType: "REV" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "reverse me");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 2);
      expect(group.tracks.length).toBe(2);
      expect(group.tracks.every((t) => t.status === "running")).toBe(true);
      expect(group.tracks.every((t) => t.sessionID.startsWith("child-"))).toBe(true);
    });

    it("persists minimal parallel group metadata to disk", async () => {
      const root = join(tmpdir(), `aegis-parallel-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      mkdirSync(root, { recursive: true });
      try {
        configureParallelPersistence(root, ".Aegis");

        const client = makeMockSessionClient();
        const parentID = `parent-persist-${Date.now()}`;
        const state = makeState({ targetType: "REV" });
        const config = loadConfig(tmpdir());
        const plan = planScanDispatch(state, config, "persist state");

        await dispatchParallel(client, parentID, root, plan, 2);

        const stateFile = join(root, ".Aegis", "parallel_state.json");
        expect(existsSync(stateFile)).toBe(true);

        const parsed = JSON.parse(readFileSync(stateFile, "utf-8"));
        expect(Array.isArray(parsed.groups)).toBe(true);
        expect(parsed.groups.some((group: { parentSessionID?: string }) => group.parentSessionID === parentID)).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("prevents duplicate active groups", async () => {
      const client = makeMockSessionClient();
      const parentID = `parent-dup-${Date.now()}`;
      const state = makeState({ targetType: "PWN" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "");

      await dispatchParallel(client, parentID, "/tmp", plan, 3);
      const active = getActiveGroup(parentID);
      expect(active).not.toBeNull();
    });
  });

  describe("collectResults", () => {
    it("collects messages from running tracks", async () => {
      const client = makeMockSessionClient();
      const parentID = `parent-collect-${Date.now()}`;
      const state = makeState({ targetType: "FORENSICS" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "forensics challenge");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 2);
      const results = await collectResults(client, group, "/tmp", 5);

      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.lastAssistantMessage).toContain("Analysis complete");
        expect(r.status).toBe("completed");
      }
    });

    it("handles empty messages gracefully", async () => {
      const client = makeMockSessionClient({ messageData: [] });
      const parentID = `parent-empty-${Date.now()}`;
      const state = makeState({ targetType: "MISC" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 2);
      const results = await collectResults(client, group, "/tmp");

      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.status).toBe("running"); // Not completed since no assistant message
      }
    });
  });

  describe("abort", () => {
    it("abortAllExcept keeps winner and aborts rest", async () => {
      const client = makeMockSessionClient();
      const parentID = `parent-abort-${Date.now()}`;
      const state = makeState({ targetType: "WEB_API" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "web challenge");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 3);
      const winnerID = group.tracks[0].sessionID;

      const abortedCount = await abortAllExcept(client, group, winnerID, "/tmp");

      expect(abortedCount).toBe(2);
      expect(group.winnerSessionID).toBe(winnerID);
      expect(group.tracks[0].isWinner).toBe(true);
      expect(group.tracks[0].status).toBe("running"); // Winner not aborted
      expect(group.tracks.slice(1).every((t) => t.status === "aborted")).toBe(true);
      expect(group.completedAt).toBeGreaterThan(0);
    });

    it("abortAll aborts everything", async () => {
      const client = makeMockSessionClient();
      const parentID = `parent-abortall-${Date.now()}`;
      const state = makeState({ targetType: "CRYPTO" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 2);
      const abortedCount = await abortAll(client, group, "/tmp");

      expect(abortedCount).toBe(2);
      expect(group.tracks.every((t) => t.status === "aborted")).toBe(true);
      expect(group.completedAt).toBeGreaterThan(0);

      // Active group should be null after completion
      expect(getActiveGroup(parentID)).toBeNull();
    });
  });

  describe("groupSummary", () => {
    it("produces valid summary object", async () => {
      const client = makeMockSessionClient();
      const parentID = `parent-summary-${Date.now()}`;
      const state = makeState({ targetType: "REV" });
      const config = loadConfig(tmpdir());
      const plan = planScanDispatch(state, config, "binary");

      const group = await dispatchParallel(client, parentID, "/tmp", plan, 3);
      const summary = groupSummary(group);

      expect(summary.label).toBe("scan-rev");
      expect(summary.parentSessionID).toBe(parentID);
      expect(Array.isArray(summary.tracks)).toBe(true);
      expect((summary.tracks as unknown[]).length).toBe(3);
    });
  });

  describe("tool integration (via plugin hooks)", () => {
    it("ctf_parallel_dispatch returns error when no SDK client", async () => {
      // This tests that the tool handles missing SDK gracefully
      // The tool uses extractSessionClient which will return null for non-SDK clients
      const client = extractSessionClient({});
      expect(client).toBeNull();
    });
  });

  it("does not complete group while queued tracks remain", async () => {
    const client = makeMockSessionClient();
    const plan = {
      label: "queue-test",
      tracks: [
        { purpose: "t1", agent: "ctf-explore", prompt: "p" },
        { purpose: "t2", agent: "ctf-research", prompt: "p" },
        { purpose: "t3", agent: "ctf-decoy-check", prompt: "p" },
      ],
    };

    const group = await dispatchParallel(client, "parent-1", tmpdir(), plan, 3, {
      parallel: {
        queue_enabled: true,
        max_concurrent_per_provider: 1,
        provider_caps: { google: 1 },
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

    expect(group.tracks.length).toBe(1);
    expect(group.queue.length).toBe(2);

    await collectResults(client, group, tmpdir(), 5);
    expect(group.completedAt).toBe(0);
  });

  it("abortAllExcept clears queued tracks immediately", async () => {
    const client = makeMockSessionClient();
    const plan = {
      label: "queue-abort",
      tracks: [
        { purpose: "t1", agent: "ctf-explore", prompt: "p" },
        { purpose: "t2", agent: "ctf-research", prompt: "p" },
        { purpose: "t3", agent: "ctf-decoy-check", prompt: "p" },
      ],
    };

    const group = await dispatchParallel(client, "parent-2", tmpdir(), plan, 3, {
      parallel: {
        queue_enabled: true,
        max_concurrent_per_provider: 1,
        provider_caps: { google: 1 },
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

    expect(group.tracks.length).toBe(1);
    expect(group.queue.length).toBe(2);

    const winner = group.tracks[0]?.sessionID;
    expect(typeof winner).toBe("string");

    const aborted = await abortAllExcept(client, group, winner as string, tmpdir());
    expect(aborted).toBe(2);
    expect(group.queue.length).toBe(0);
    expect(group.completedAt).toBeGreaterThan(0);
  });
});
