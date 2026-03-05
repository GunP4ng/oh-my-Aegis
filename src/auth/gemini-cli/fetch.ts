import { runGeminiCli, type GeminiCliResult } from "../../orchestration/gemini-cli";
import { runClaudeCodeCli, type ClaudeCodeCliResult } from "../../orchestration/claude-code-cli";
import { isRecord } from "../../utils/is-record";
import {
  asOpenAIMessages,
  asOpenAITools,
  buildOpenAIChatCompletionResponse,
  buildOpenAIChatCompletionToolCallsResponse,
  buildTranscript,
  modelIdFromOpenAIModel,
  parseToolEnvelope,
  sseSingleChunk,
  type OpenAIChatMessage,
  type OpenAITool,
} from "./openai-compat";

export type GeminiCliFetchDeps = {
  runGeminiCliImpl?: typeof runGeminiCli;
  runClaudeCodeCliImpl?: typeof runClaudeCodeCli;
};

export type GeminiCliFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const SUPPORTED_MODEL_CLI_MODELS = [
  "gemini-3.1-pro",
  "gemini-3.1-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "claude-sonnet-4.6",
  "claude-opus-4.6",
  "claude-haiku-4.5",
] as const;
const SUPPORTED_MODEL_CLI_MODEL_SET = new Set<string>(SUPPORTED_MODEL_CLI_MODELS);
type ClaudeEffort = "low" | "medium" | "high";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function buildToolInstructionEnvelope(tools: OpenAITool[]): string {
  if (tools.length === 0) {
    return [
      "Return EXACTLY one JSON object, with no surrounding text.",
      "If you are answering normally, return:",
      '{"type":"final","content":"..."}',
    ].join("\n");
  }
  const toolList = tools
    .map((t) => {
      const fn = t.function;
      return {
        name: fn.name,
        description: fn.description ?? "",
        parameters: fn.parameters ?? { type: "object", properties: {} },
      };
    })
    .slice(0, 64);

  return [
    "Return EXACTLY one JSON object, with no surrounding text.",
    "You MUST choose one of these shapes:",
    '{"type":"final","content":"..."}',
    '{"type":"tool-calls","tool_calls":[{"id":"call_1","name":"toolName","arguments":{}}]}',
    "Allowed tools:",
    JSON.stringify(toolList),
  ].join("\n");
}

function buildPrompt(messages: OpenAIChatMessage[], tools: OpenAITool[]): string {
  const transcript = buildTranscript(messages);
  const toolEnvelope = buildToolInstructionEnvelope(tools);
  return [
    "You are a careful assistant.",
    toolEnvelope,
    "---",
    transcript,
  ].join("\n");
}

function extractOpenAIRequest(raw: unknown):
  | {
      ok: true;
      model: string;
      messages: OpenAIChatMessage[];
      tools: OpenAITool[];
      stream: boolean;
      effort?: ClaudeEffort;
    }
  | { ok: false; status: number; reason: string } {
  if (!isRecord(raw)) {
    return { ok: false as const, status: 400, reason: "invalid request body" };
  }
  const messages = asOpenAIMessages(raw.messages);
  if (!messages) {
    return { ok: false as const, status: 400, reason: "missing or invalid messages" };
  }
  const tools = asOpenAITools(raw.tools);
  const model = modelIdFromOpenAIModel(raw.model) || "";
  const stream = raw.stream === true;
  const effort = extractClaudeEffort(raw);
  return { ok: true as const, model, messages, tools, stream, effort };
}

function normalizeClaudeEffort(value: unknown): ClaudeEffort | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return undefined;
}

function extractClaudeEffort(raw: Record<string, unknown>): ClaudeEffort | undefined {
  const direct = normalizeClaudeEffort(raw.effort);
  if (direct) return direct;

  const variant = normalizeClaudeEffort(raw.variant);
  if (variant) return variant;

  const reasoningEffort = normalizeClaudeEffort(raw.reasoningEffort);
  if (reasoningEffort) return reasoningEffort;

  const snakeReasoningEffort = normalizeClaudeEffort(raw.reasoning_effort);
  if (snakeReasoningEffort) return snakeReasoningEffort;

  const reasoning = raw.reasoning;
  if (isRecord(reasoning)) {
    const nestedEffort = normalizeClaudeEffort(reasoning.effort);
    if (nestedEffort) return nestedEffort;
  }

  return undefined;
}

function normalizeCliModel(model: string): string | undefined {
  const trimmed = model.trim();
  if (!trimmed) return undefined;
  const idx = trimmed.indexOf("/");
  if (idx === -1) return trimmed;
  const m = trimmed.slice(idx + 1).trim();
  return m || undefined;
}

function toClaudeCliModelAlias(model: string | undefined): string | undefined {
  const normalized = (model ?? "").toLowerCase();
  if (normalized.startsWith("claude-opus-")) return "opus";
  if (normalized.startsWith("claude-haiku-")) return "haiku";
  if (normalized.startsWith("claude-sonnet-")) return "sonnet";
  return model;
}

function asCliError(
  result: GeminiCliResult | ClaudeCodeCliResult,
  fallbackMessage: string,
): { ok: false; status: number; body: Record<string, unknown> } | null {
  if (result.ok) return null;
  const status = result.exit_code === 124 ? 504 : 502;
  return {
    ok: false,
    status,
    body: {
      error: {
        message: result.reason ?? fallbackMessage,
        exit_code: result.exit_code ?? null,
      },
    },
  };
}

export function createGeminiCliFetch(deps: GeminiCliFetchDeps = {}): GeminiCliFetch {
  const runGeminiCliImpl = deps.runGeminiCliImpl ?? runGeminiCli;
  const runClaudeCodeCliImpl = deps.runClaudeCodeCliImpl ?? runClaudeCodeCli;

  return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = init?.body;
    if (body !== undefined && typeof body !== "string") {
      return jsonResponse(400, { ok: false, reason: "body must be a JSON string" });
    }
    if (typeof body !== "string" || body.trim().length === 0) {
      return jsonResponse(400, { ok: false, reason: "missing body" });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      return jsonResponse(400, { ok: false, reason: "invalid JSON body" });
    }

    const req = extractOpenAIRequest(parsedBody);
    if (!req.ok) {
      return jsonResponse(req.status, { ok: false, reason: req.reason });
    }

    const prompt = buildPrompt(req.messages, req.tools);
    const model = normalizeCliModel(req.model);
    if (model && !SUPPORTED_MODEL_CLI_MODEL_SET.has(model)) {
      const supported = SUPPORTED_MODEL_CLI_MODELS.join(", ");
      return jsonResponse(400, {
        ok: false,
        reason: `Unsupported model: ${model}. Supported models: ${supported}`,
      });
    }
    const useClaudeCli = (model ?? "").toLowerCase().startsWith("claude-");
    const modelForCli = useClaudeCli ? toClaudeCliModelAlias(model) : model;

    const result = useClaudeCli
      ? await runClaudeCodeCliImpl({
          prompt,
          model: modelForCli,
          effort: req.effort,
          allowMissingProposalContext: true,
          cwd: process.cwd(),
          env: process.env,
        })
      : await runGeminiCliImpl({
          prompt,
          model: modelForCli,
          allowMissingProposalContext: true,
          cwd: process.cwd(),
          env: process.env,
        });

    const err = asCliError(result, useClaudeCli ? "Claude Code CLI failed" : "Gemini CLI failed");
    if (err) {
      return jsonResponse(err.status, err.body);
    }

    const responseText = typeof result.response_text === "string" ? result.response_text : "";
    const envelope = parseToolEnvelope(responseText);
    const outModel = req.model || (model ?? "");

    const responseBody = envelope
      ? envelope.type === "tool-calls"
        ? buildOpenAIChatCompletionToolCallsResponse({ model: outModel, toolCalls: envelope.tool_calls })
        : buildOpenAIChatCompletionResponse({ model: outModel, content: envelope.content })
      : buildOpenAIChatCompletionResponse({ model: outModel, content: responseText });

    if (req.stream) {
      return sseResponse(sseSingleChunk(responseBody));
    }

    return jsonResponse(200, responseBody);
  };
}
