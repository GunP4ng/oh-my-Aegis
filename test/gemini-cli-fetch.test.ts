import { describe, expect, it } from "bun:test";

import { createGeminiCliFetch } from "../src/auth/gemini-cli/fetch";

describe("gemini cli fetch interceptor", () => {
  it("fails closed when init.body is not a string", async () => {
    const fetchFn = createGeminiCliFetch({
      runGeminiCliImpl: async () => ({ ok: true, response_text: "" }),
    });

    const res = await fetchFn("http://localhost", { method: "POST", body: new Uint8Array([1, 2, 3]) as any });
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { ok?: boolean; reason?: string };
    expect(parsed.ok).toBe(false);
    expect(String(parsed.reason || "")).toContain("body must be a JSON string");
  });

  it("returns 400 for unsupported model_cli model ids", async () => {
    const fetchFn = createGeminiCliFetch({
      runGeminiCliImpl: async () => {
        throw new Error("runGeminiCliImpl must not be called for unsupported models");
      },
      runClaudeCodeCliImpl: async () => {
        throw new Error("runClaudeCodeCliImpl must not be called for unsupported models");
      },
    });

    const body = JSON.stringify({
      model: "model_cli/gemini-unknown",
      messages: [{ role: "user", content: "hello" }],
    });

    const res = await fetchFn("http://127.0.0.1/v1/chat/completions", { method: "POST", body });
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { ok?: boolean; reason?: string };
    expect(parsed.ok).toBe(false);
    expect(String(parsed.reason || "")).toContain("Supported models");
    expect(String(parsed.reason || "")).toContain("gemini-unknown");
  });

  it("routes claude-* models to Claude CLI and maps timeout to 504", async () => {
    let geminiCallCount = 0;
    let claudeCallCount = 0;
    let receivedClaudeModel: string | undefined;

    const fetchFn = createGeminiCliFetch({
      runGeminiCliImpl: async () => {
        geminiCallCount += 1;
        return { ok: true, response_text: "GEMINI_SHOULD_NOT_BE_USED" };
      },
      runClaudeCodeCliImpl: async (args) => {
        claudeCallCount += 1;
        receivedClaudeModel = args.model;
        if (claudeCallCount === 1) {
          return { ok: true, response_text: "CLAUDE_ROUTED_OK" };
        }
        return { ok: false, exit_code: 124, reason: "CLAUDE_TIMEOUT" };
      },
    });

    const okBody = JSON.stringify({
      model: "model_cli/claude-sonnet-4.6",
      messages: [{ role: "user", content: "route this to claude" }],
    });

    const okRes = await fetchFn("http://127.0.0.1/v1/chat/completions", { method: "POST", body: okBody });
    expect(okRes.status).toBe(200);
    const okParsed = (await okRes.json()) as any;
    expect(okParsed?.choices?.[0]?.message?.content).toBe("CLAUDE_ROUTED_OK");
    expect(receivedClaudeModel).toBe("sonnet");
    expect(geminiCallCount).toBe(0);
    expect(claudeCallCount).toBe(1);

    const timeoutBody = JSON.stringify({
      model: "model_cli/claude-sonnet-4.6",
      messages: [{ role: "user", content: "timeout path" }],
    });

    const timeoutRes = await fetchFn("http://127.0.0.1/v1/chat/completions", { method: "POST", body: timeoutBody });
    expect(timeoutRes.status).toBe(504);
    const timeoutParsed = (await timeoutRes.json()) as { error?: { message?: string; exit_code?: number | null } };
    expect(timeoutParsed?.error?.message).toBe("CLAUDE_TIMEOUT");
    expect(timeoutParsed?.error?.exit_code).toBe(124);
    expect(geminiCallCount).toBe(0);
    expect(claudeCallCount).toBe(2);
  });

  it("routes claude-haiku-* models to Claude CLI haiku alias", async () => {
    let receivedClaudeModel: string | undefined;
    const fetchFn = createGeminiCliFetch({
      runGeminiCliImpl: async () => ({ ok: true, response_text: "GEMINI_SHOULD_NOT_BE_USED" }),
      runClaudeCodeCliImpl: async (args) => {
        receivedClaudeModel = args.model;
        return { ok: true, response_text: "HAIKU_ROUTED_OK" };
      },
    });

    const body = JSON.stringify({
      model: "model_cli/claude-haiku-4.5",
      messages: [{ role: "user", content: "route this to claude haiku" }],
    });

    const res = await fetchFn("http://127.0.0.1/v1/chat/completions", { method: "POST", body });
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as any;
    expect(parsed?.choices?.[0]?.message?.content).toBe("HAIKU_ROUTED_OK");
    expect(receivedClaudeModel).toBe("haiku");
  });

  it("returns tool_calls when Gemini CLI returns tool-calls envelope", async () => {
    const fetchFn = createGeminiCliFetch({
      runGeminiCliImpl: async () => ({
        ok: true,
        response_text: JSON.stringify({
          type: "tool-calls",
          tool_calls: [{ id: "call_1", name: "read", arguments: { filePath: "README.md" } }],
        }),
      }),
    });

    const body = JSON.stringify({
      model: "model_cli/gemini-2.5-pro",
      messages: [{ role: "user", content: "use tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read",
            description: "read a file",
            parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] },
          },
        },
      ],
    });

    const res = await fetchFn("http://127.0.0.1/v1/chat/completions", { method: "POST", body });
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as any;
    expect(parsed?.choices?.[0]?.finish_reason).toBe("tool_calls");
    expect(parsed?.choices?.[0]?.message?.tool_calls?.[0]?.function?.name).toBe("read");
    expect(typeof parsed?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments).toBe("string");
  });

  it("streams as single SSE chunk when stream=true", async () => {
    const fetchFn = createGeminiCliFetch({
      runGeminiCliImpl: async () => ({ ok: true, response_text: JSON.stringify({ type: "final", content: "hi" }) }),
    });

    const body = JSON.stringify({
      model: "gemini-2.5-pro",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    });

    const res = await fetchFn("http://127.0.0.1/v1/chat/completions", { method: "POST", body });
    expect(res.status).toBe(200);
    expect(String(res.headers.get("content-type") || "")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("data: ");
    expect(text).toContain("[DONE]");
  });
});
