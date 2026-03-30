import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import { globToRegExp, isPathInsideRoot, normalizePathForMatch } from "../helpers/plugin-utils";
import { mergeCachedClaudeToolArgs } from "./claude-tool-call-cache";

const schema = tool.schema;
const MAX_RESULTS = 500;

type GlobArgs = {
  pattern?: string;
  path?: string;
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

function annotateTitle(context: ToolContext | undefined): void {
  if (typeof context?.metadata === "function") {
    context.metadata({ title: "aegis_glob" });
  }
}

function walkFiles(root: string, currentDir: string, out: string[]): void {
  if (out.length >= MAX_RESULTS) {
    return;
  }

  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= MAX_RESULTS) {
      return;
    }

    const absPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(root, absPath, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = normalizePathForMatch(absPath.slice(root.length + 1));
    out.push(relativePath);
  }
}

export function createClaudeSafeGlobTool(projectDir: string): ToolDefinition {
  return tool({
    description: "Match files by glob pattern. Use pattern and optional path (directory to search in).",
    args: {
      pattern: schema.string().min(1),
      path: schema.string().optional(),
    },
    execute: async (args: GlobArgs, context) => {
      annotateTitle(context);
      const input = mergeCachedClaudeToolArgs("aegis_glob", args);
      const pattern = firstString(input, ["pattern"]);
      if (!pattern) {
        return JSON.stringify({ ok: false, reason: "missing pattern" }, null, 2);
      }

      const requestedPath = firstString(input, ["path"]);
      const searchRoot = requestedPath
        ? isAbsolute(requestedPath)
          ? requestedPath
          : resolve(projectDir, requestedPath)
        : projectDir;

      if (!isPathInsideRoot(searchRoot, projectDir)) {
        return JSON.stringify({ ok: false, reason: "path must be inside projectDir", path: searchRoot }, null, 2);
      }

      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(searchRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ ok: false, reason: message, path: searchRoot }, null, 2);
      }

      if (!stat.isDirectory()) {
        return JSON.stringify({ ok: false, reason: "path is not a directory", path: searchRoot }, null, 2);
      }

      const matcher = globToRegExp(pattern);
      const files: string[] = [];
      walkFiles(searchRoot, searchRoot, files);
      const matches = files.filter((relativePath) => matcher.test(relativePath)).sort((a, b) => a.localeCompare(b));
      return matches.join("\n");
    },
  });
}
