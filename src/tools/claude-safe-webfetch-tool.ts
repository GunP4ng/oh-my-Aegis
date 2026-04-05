import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import { mergeCachedClaudeToolArgs } from "./claude-tool-call-cache";

const schema = tool.schema;
const DEFAULT_WEBFETCH_TIMEOUT_SECONDS = 30;
const MAX_WEBFETCH_TIMEOUT_SECONDS = 120;

type WebfetchArgs = {
  url: string;
  target_url?: string;
  targetUrl?: string;
  response_format?: "text" | "markdown" | "html";
  responseFormat?: "text" | "markdown" | "html";
  format?: "text" | "markdown" | "html";
  timeout_seconds?: number;
  timeoutSeconds?: number;
  timeout?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function resolveFormat(source: Record<string, unknown>): "text" | "markdown" | "html" {
  const raw = firstString(source, ["response_format", "responseFormat", "format"]);
  return raw === "text" || raw === "html" ? raw : "markdown";
}

function buildAcceptHeader(format: "text" | "markdown" | "html"): string {
  if (format === "markdown") {
    return "text/markdown, text/plain, text/html;q=0.8, */*;q=0.5";
  }
  if (format === "html") {
    return "text/html, text/plain;q=0.9, */*;q=0.5";
  }
  return "text/plain, text/html;q=0.8, */*;q=0.5";
}

function normalizeWebfetchTimeout(timeout: number | undefined): number {
  if (!Number.isFinite(timeout)) return DEFAULT_WEBFETCH_TIMEOUT_SECONDS;
  const raw = Math.max(1, Math.floor(timeout ?? DEFAULT_WEBFETCH_TIMEOUT_SECONDS));
  return Math.min(raw, MAX_WEBFETCH_TIMEOUT_SECONDS);
}

function annotateTitle(context: ToolContext | undefined): void {
  if (typeof context?.metadata === "function") {
    context.metadata({ title: "aegis_webfetch" });
  }
}

export function createClaudeSafeWebfetchTool(): ToolDefinition {
  return tool({
    description: "Fetch a URL and return its contents. Use url (preferred), optional response_format, and optional timeout_seconds.",
    args: {
      url: schema.string().min(1),
      target_url: schema.string().min(1).optional(),
      targetUrl: schema.string().min(1).optional(),
      response_format: schema.enum(["text", "markdown", "html"]).default("markdown"),
      responseFormat: schema.enum(["text", "markdown", "html"]).optional(),
      format: schema.enum(["text", "markdown", "html"]).optional(),
      timeout_seconds: schema.number().optional(),
      timeoutSeconds: schema.number().optional(),
      timeout: schema.number().optional(),
    },
    execute: async (args: WebfetchArgs, context) => {
      annotateTitle(context);
      const input = mergeCachedClaudeToolArgs("aegis_webfetch", args);
      const targetUrl = firstString(input, ["target_url", "targetUrl", "url"]);
      if (!targetUrl) {
        return JSON.stringify({ ok: false, reason: "missing target url" }, null, 2);
      }

      const format = resolveFormat(input);
      const timeoutSeconds = normalizeWebfetchTimeout(firstNumber(input, ["timeout_seconds", "timeoutSeconds", "timeout"]));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          headers: {
            Accept: buildAcceptHeader(format),
            "User-Agent": "oh-my-aegis/claude-safe-webfetch",
          },
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          return JSON.stringify(
              {
                ok: false,
                status: response.status,
                status_text: response.statusText,
                url: targetUrl,
                body: text,
              },
              null,
              2,
            );
          }
          return text;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ ok: false, reason: message, url: targetUrl }, null, 2);
        } finally {
          clearTimeout(timeout);
        }
      },
    });
  }
