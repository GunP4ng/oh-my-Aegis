import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrchestratorConfigSchema } from "../src/config/schema";
import { extractErrorMessage, extractMessageIndexFromError } from "../src/recovery/error-utils";
import {
  createContextWindowRecoveryManager,
  extractContextUsageRatio,
} from "../src/recovery/context-window-recovery";
import { parseModelId } from "../src/recovery/model-id";
import { detectSessionRecoveryErrorType } from "../src/recovery/session-recovery";
import { NotesStore } from "../src/state/notes-store";
import { SessionStore } from "../src/state/session-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function createHarness(overrides?: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "aegis-recovery-"));
  roots.push(root);

  const config = OrchestratorConfigSchema.parse({
    recovery: {
      context_window_recovery_cooldown_ms: 0,
      ...overrides,
    },
  });

  const summarizeCalls: unknown[] = [];
  const promptCalls: unknown[] = [];

  const client = {
    session: {
      create: async () => ({ data: { id: "child" } }),
      promptAsync: async (args: unknown) => {
        promptCalls.push(args);
        return { data: {} };
      },
      messages: async () => ({ data: [] }),
      abort: async () => ({ data: {} }),
      summarize: async (args: unknown) => {
        summarizeCalls.push(args);
        return { data: {} };
      },
    },
  };

  const notesStore = new NotesStore(root, config.markdown_budget, ".Aegis");
  const store = new SessionStore(root, undefined, config.default_mode, config.notes.root_dir);
  const manager = createContextWindowRecoveryManager({
    client,
    directory: root,
    notesStore,
    config,
    store,
    getDefaultModel: () => "openai/gpt-5.2",
  });

  return { manager, summarizeCalls, promptCalls };
}

describe("recovery/error-utils", () => {
  it("extractErrorMessage handles string", () => {
    expect(extractErrorMessage("hello")).toBe("hello");
  });

  it("extractErrorMessage handles Error", () => {
    expect(extractErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("extractErrorMessage handles nested shapes", () => {
    const err = { data: { error: { message: "nested" } } };
    expect(extractErrorMessage(err)).toBe("nested");
  });

  it("extractMessageIndexFromError extracts index", () => {
    const err = { message: "Invalid: messages.12 must start with thinking" };
    expect(extractMessageIndexFromError(err)).toBe(12);
  });
});

describe("recovery/model-id", () => {
  it("parses provider/model", () => {
    expect(parseModelId("openai/gpt-5.3-codex")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.3-codex",
    });
  });

  it("handles missing slash", () => {
    expect(parseModelId("gpt-5.3-codex")).toEqual({
      providerID: "unknown",
      modelID: "gpt-5.3-codex",
    });
  });

  it("handles empty input", () => {
    expect(parseModelId("")).toEqual({ providerID: "unknown", modelID: "" });
  });
});

describe("recovery/session-recovery detector", () => {
  it("detects tool_result_missing", () => {
    const msg = "Expected tool_result for tool_use but found none";
    expect(detectSessionRecoveryErrorType(msg)).toBe("tool_result_missing");
  });

  it("detects thinking_disabled_violation", () => {
    const msg = "Thinking is disabled and cannot contain reasoning";
    expect(detectSessionRecoveryErrorType(msg)).toBe("thinking_disabled_violation");
  });

  it("detects thinking_block_order", () => {
    const msg = "Expected thinking but found tool_use";
    expect(detectSessionRecoveryErrorType(msg)).toBe("thinking_block_order");
  });

  it("returns null for unrelated errors", () => {
    expect(detectSessionRecoveryErrorType("some random error")).toBeNull();
  });
});

describe("recovery/context-window usage ratio", () => {
  it("extracts ratio from percent-like values", () => {
    expect(extractContextUsageRatio({ info: { contextWindowPercent: 92 } })).toBe(0.92);
  });

  it("extracts ratio from usage totals", () => {
    expect(
      extractContextUsageRatio({
        info: {
          usage: {
            total_tokens: 900,
            context_window_tokens: 1000,
          },
        },
      }),
    ).toBe(0.9);
  });
});

describe("recovery/context-window proactive", () => {
  it("triggers proactive summarize and injects continuation manager prompt", async () => {
    const { manager, summarizeCalls, promptCalls } = createHarness();

    await manager.handleEvent("message.updated", {
      info: {
        sessionID: "ses-1",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.2",
        contextUsageRatio: 0.91,
      },
    });

    expect(summarizeCalls.length).toBe(1);
    expect(promptCalls.length).toBe(1);

    const firstPrompt = promptCalls[0];
    expect(typeof firstPrompt).toBe("object");
    if (firstPrompt && typeof firstPrompt === "object") {
      const text = (firstPrompt as { text?: unknown }).text;
      expect(typeof text).toBe("string");
      if (typeof text === "string") {
        expect(text.includes("manager mode")).toBe(true);
        expect(text.includes("STATE/WORKLOG/EVIDENCE/CONTEXT_PACK")).toBe(true);
      }
    }
  });

  it("respects proactive arm/rearm thresholds", async () => {
    const { manager, summarizeCalls } = createHarness({
      context_window_proactive_threshold_ratio: 0.9,
      context_window_proactive_rearm_ratio: 0.75,
    });

    await manager.handleEvent("message.updated", {
      info: {
        sessionID: "ses-2",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.2",
        contextUsageRatio: 0.91,
      },
    });
    await manager.handleEvent("message.updated", {
      info: {
        sessionID: "ses-2",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.2",
        contextUsageRatio: 0.95,
      },
    });

    expect(summarizeCalls.length).toBe(1);

    await manager.handleEvent("message.updated", {
      info: {
        sessionID: "ses-2",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.2",
        contextUsageRatio: 0.7,
      },
    });
    await manager.handleEvent("message.updated", {
      info: {
        sessionID: "ses-2",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.2",
        contextUsageRatio: 0.93,
      },
    });

    expect(summarizeCalls.length).toBe(2);
  });

  it("does not run proactive path when disabled", async () => {
    const { manager, summarizeCalls } = createHarness({
      context_window_proactive_compaction: false,
    });

    await manager.handleEvent("message.updated", {
      info: {
        sessionID: "ses-3",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.2",
        contextUsageRatio: 0.95,
      },
    });

    expect(summarizeCalls.length).toBe(0);
  });
});
