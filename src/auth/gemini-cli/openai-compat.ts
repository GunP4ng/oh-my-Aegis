import { isRecord } from "../../utils/is-record";

export type OpenAIChatRole = "system" | "user" | "assistant" | "tool";

export type OpenAIChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; content: string; tool_call_id?: string };

export type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export function modelIdFromOpenAIModel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const idx = trimmed.indexOf("/");
  if (idx === -1) return trimmed;
  return trimmed.slice(idx + 1);
}

export function asOpenAIMessages(value: unknown): OpenAIChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const out: OpenAIChatMessage[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const role = item.role;
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {
      return null;
    }
    const content = item.content;
    if (role === "assistant") {
      out.push({ role, content: typeof content === "string" ? content : content === null ? null : "" });
      continue;
    }
    if (typeof content !== "string") return null;
    if (role === "tool") {
      const tool_call_id = typeof item.tool_call_id === "string" ? item.tool_call_id : undefined;
      out.push({ role, content, tool_call_id });
      continue;
    }
    out.push({ role, content });
  }
  return out;
}

export function asOpenAITools(value: unknown): OpenAITool[] {
  if (!Array.isArray(value)) return [];
  const out: OpenAITool[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (item.type !== "function") continue;
    const fn = item.function;
    if (!isRecord(fn)) continue;
    const name = typeof fn.name === "string" ? fn.name.trim() : "";
    if (!name) continue;
    const description = typeof fn.description === "string" ? fn.description : undefined;
    const parameters = isRecord(fn.parameters) ? (fn.parameters as Record<string, unknown>) : undefined;
    out.push({
      type: "function",
      function: { name, description, parameters },
    });
  }
  return out;
}

export function buildTranscript(messages: OpenAIChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const suffix = m.tool_call_id ? ` tool_call_id=${m.tool_call_id}` : "";
      lines.push(`[tool${suffix}] ${m.content}`);
      continue;
    }
    const role = m.role;
    const content = typeof (m as any).content === "string" ? ((m as any).content as string) : "";
    lines.push(`[${role}] ${content}`);
  }
  return lines.join("\n");
}

export type ToolEnvelope =
  | { type: "final"; content: string }
  | { type: "tool-calls"; tool_calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> };

export function parseToolEnvelope(text: string): ToolEnvelope | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const t = parsed.type;
  if (t === "final") {
    const content = typeof parsed.content === "string" ? parsed.content : "";
    return { type: "final", content };
  }
  if (t === "tool-calls") {
    const calls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
    const out: ToolEnvelope = { type: "tool-calls", tool_calls: [] };
    for (const c of calls) {
      if (!isRecord(c)) continue;
      const id = typeof c.id === "string" ? c.id : "";
      const name = typeof c.name === "string" ? c.name : "";
      const args = isRecord(c.arguments) ? (c.arguments as Record<string, unknown>) : null;
      if (!id || !name || !args) continue;
      out.tool_calls.push({ id, name, arguments: args });
    }
    return out.tool_calls.length > 0 ? out : null;
  }
  return null;
}

export function buildOpenAIChatCompletionResponse(params: {
  model: string;
  content: string;
}): Record<string, unknown> {
  return {
    id: `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: params.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: params.content },
        finish_reason: "stop",
      },
    ],
  };
}

export function buildOpenAIChatCompletionToolCallsResponse(params: {
  model: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}): Record<string, unknown> {
  return {
    id: `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: params.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: params.toolCalls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          })),
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

export function sseSingleChunk(payload: Record<string, unknown>): string {
  const data = JSON.stringify(payload);
  return `data: ${data}\n\ndata: [DONE]\n\n`;
}
