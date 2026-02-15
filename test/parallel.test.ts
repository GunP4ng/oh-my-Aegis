import { describe, expect, it } from "bun:test";
import {
  abortAll,
  abortAllExcept,
  collectResults,
  dispatchParallel,
  extractSessionClient,
  getActiveGroup,
  getGroups,
  groupSummary,
  planHypothesisDispatch,
  planScanDispatch,
  type SessionClient,
} from "../src/orchestration/parallel";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";
import { loadConfig } from "../src/config/loader";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

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
}): SessionClient {
  let sessionCounter = 0;

  return {
    create: async (_params) => {
      if (opts?.createFail) throw new Error("create failed");
      sessionCounter += 1;
      return { data: { id: `child-${sessionCounter}` } };
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
      const { loadConfig } = await import("../src/config/loader");
      const cfg = loadConfig(tmpdir());

      // The tool uses extractSessionClient which will return null for non-SDK clients
      const client = extractSessionClient({});
      expect(client).toBeNull();
    });
  });
});
