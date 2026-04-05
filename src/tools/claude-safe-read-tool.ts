import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import { mergeCachedClaudeToolArgs } from "./claude-tool-call-cache";

const schema = tool.schema;
const DEFAULT_READ_LIMIT = 2000;
const MAX_READ_LIMIT = 5000;

type ReadArgs = {
  filePath: string;
  target_path?: string;
  targetPath?: string;
  path?: string;
  start_line?: number;
  offset?: number;
  max_lines?: number;
  limit?: number;
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

function normalizeReadOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) return 1;
  return Math.max(1, Math.floor(offset ?? 1));
}

function normalizeReadLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_READ_LIMIT;
  const raw = Math.max(0, Math.floor(limit ?? DEFAULT_READ_LIMIT));
  return Math.min(raw, MAX_READ_LIMIT);
}

function formatNumberedLines(lines: string[], startLine: number): string {
  if (lines.length === 0) return "";
  return lines.map((line, idx) => `${startLine + idx}: ${line}`).join("\n");
}

function annotateTitle(context: ToolContext | undefined): void {
  if (typeof context?.metadata === "function") {
    context.metadata({ title: "aegis_read" });
  }
}

export function createClaudeSafeReadTool(projectDir: string): ToolDefinition {
  return tool({
    description: "Read a text file or list a directory with numbered lines. Use filePath (preferred), optional start_line, and optional max_lines.",
    args: {
      filePath: schema.string().min(1),
      target_path: schema.string().min(1).optional(),
      targetPath: schema.string().min(1).optional(),
      path: schema.string().min(1).optional(),
      start_line: schema.number().optional(),
      offset: schema.number().optional(),
      max_lines: schema.number().optional(),
      limit: schema.number().optional(),
    },
    execute: async (args: ReadArgs, context) => {
      annotateTitle(context);
      const input = mergeCachedClaudeToolArgs("aegis_read", args);
      const targetPath = firstString(input, ["target_path", "targetPath", "filePath", "path"]);
      if (!targetPath) {
        return JSON.stringify({ ok: false, reason: "missing target path" }, null, 2);
      }

      const resolvedPath = isAbsolute(targetPath) ? targetPath : resolve(projectDir, targetPath);
      if (!existsSync(resolvedPath)) {
        return JSON.stringify({ ok: false, reason: "path not found", path: resolvedPath }, null, 2);
      }

      try {
        const stat = statSync(resolvedPath);
        if (stat.isDirectory()) {
          const entries = readdirSync(resolvedPath, { withFileTypes: true })
            .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
            .sort((a, b) => a.localeCompare(b));
          return entries.join("\n");
        }
        if (!stat.isFile()) {
          return JSON.stringify({ ok: false, reason: "path is not a file", path: resolvedPath }, null, 2);
        }

        const content = readFileSync(resolvedPath, "utf-8");
        const lines = content.split(/\r?\n/);
        const offset = normalizeReadOffset(firstNumber(input, ["start_line", "startLine", "offset"]));
        const limit = normalizeReadLimit(firstNumber(input, ["max_lines", "maxLines", "limit"]));
        const startIndex = Math.max(0, offset - 1);
        const slice = limit === 0 ? [] : lines.slice(startIndex, startIndex + limit);
        return formatNumberedLines(slice, startIndex + 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ ok: false, reason: message, path: resolvedPath }, null, 2);
      }
    },
  });
}
