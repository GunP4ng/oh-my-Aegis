import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DEFAULT_CLAUDE_TOOL_CALL_CACHE_DIR = join(tmpdir(), "opencode-cluade-auth-tool-calls");

type CachedClaudeToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function resolveClaudeToolCallCacheDir(): string {
  const configured = process.env.OPENCODE_CLAUDE_AUTH_TOOL_CALL_CACHE_DIR?.trim();
  return configured || DEFAULT_CLAUDE_TOOL_CALL_CACHE_DIR;
}

function readCachedClaudeToolCall(path: string): CachedClaudeToolCall | null {
  try {
    const parsed = asRecord(JSON.parse(readFileSync(path, "utf-8")));
    const id = typeof parsed.id === "string" ? parsed.id : "";
    const name = typeof parsed.name === "string" ? parsed.name : "";
    const args = asRecord(parsed.arguments);
    if (!id || !name || Object.keys(args).length === 0) {
      return null;
    }
    return { id, name, arguments: args };
  } catch {
    return null;
  }
}

function readLatestCachedClaudeToolCallForTool(toolName: string): CachedClaudeToolCall | null {
  const cacheDir = resolveClaudeToolCallCacheDir();
  if (!existsSync(cacheDir)) {
    return null;
  }

  try {
    const candidates = readdirSync(cacheDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => ({ path: join(cacheDir, entry), stat: statSync(join(cacheDir, entry)) }))
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

    for (const candidate of candidates) {
      const parsed = readCachedClaudeToolCall(candidate.path);
      if (parsed?.name === toolName) {
        return parsed;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function mergeCachedClaudeToolArgs(toolName: string, args: unknown): Record<string, unknown> {
  const nextArgs = { ...asRecord(args) };
  const cached = readLatestCachedClaudeToolCallForTool(toolName);
  if (!cached) {
    return nextArgs;
  }

  for (const [key, value] of Object.entries(cached.arguments)) {
    const existing = nextArgs[key];
    if (
      existing === undefined ||
      existing === null ||
      (typeof existing === "string" && existing.trim().length === 0)
    ) {
      nextArgs[key] = value;
    }
  }

  return nextArgs;
}
