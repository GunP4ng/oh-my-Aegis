import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import { mergeCachedClaudeToolArgs } from "./claude-tool-call-cache";

const schema = tool.schema;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 51_200;

export type BashPolicyEvaluator = (command: string) => { allow: boolean; reason?: string };

export interface ClaudeSafeBashOptions {
  policyEvaluator?: BashPolicyEvaluator;
  envAllowlist?: string[];
}

const DEFAULT_ENV_ALLOWLIST = new Set([
  "PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
  "TERM", "TMPDIR", "XDG_RUNTIME_DIR", "SSH_AUTH_SOCK",
]);

function buildFilteredEnv(extraKeys?: string[]): Record<string, string> {
  const allowed = new Set(DEFAULT_ENV_ALLOWLIST);
  if (extraKeys) {
    for (const k of extraKeys) allowed.add(k);
  }
  const env: Record<string, string> = { CI: "true", NO_COLOR: "1", TERM: "dumb" };
  for (const key of allowed) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

type BashArgs = {
  command?: string;
  description?: string;
  workdir?: string;
  timeout?: number;
};

export function resolveAegisBashInvocation(
  command: string,
  options?: { platform?: NodeJS.Platform; hasAbsoluteBash?: boolean },
): { command: string; args: string[] } {
  const platform = options?.platform ?? process.platform;
  const hasAbsoluteBash = options?.hasAbsoluteBash ?? existsSync("/bin/bash");

  return {
    command: platform === "win32" || !hasAbsoluteBash ? "bash" : "/bin/bash",
    args: ["-lc", command],
  };
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

function normalizeTimeout(timeout: number | undefined): number {
  if (!Number.isFinite(timeout)) {
    return DEFAULT_TIMEOUT_MS;
  }
  const raw = Math.max(100, Math.floor(timeout ?? DEFAULT_TIMEOUT_MS));
  return Math.min(raw, MAX_TIMEOUT_MS);
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n... [truncated] ...`;
}

function annotateTitle(context: ToolContext | undefined): void {
  if (typeof context?.metadata === "function") {
    context.metadata({ title: "aegis_bash" });
  }
}

export function createClaudeSafeBashTool(projectDir: string, options?: ClaudeSafeBashOptions): ToolDefinition {
  return tool({
    description:
      "Run a shell command with optional workdir and timeout. Use command, optional description, optional workdir, and optional timeout in milliseconds.",
    args: {
      command: schema.string().min(1),
      description: schema.string().optional(),
      workdir: schema.string().optional(),
      timeout: schema.number().optional(),
    },
    execute: async (args: BashArgs, context) => {
      annotateTitle(context);
      const input = mergeCachedClaudeToolArgs("aegis_bash", args);
      const command = firstString(input, ["command"]);
      if (!command) {
        return JSON.stringify({ ok: false, reason: "missing command" }, null, 2);
      }

      const requestedWorkdir = firstString(input, ["workdir", "cwd"]);
      const resolvedWorkdir = requestedWorkdir
        ? isAbsolute(requestedWorkdir)
          ? requestedWorkdir
          : resolve(projectDir, requestedWorkdir)
        : projectDir;

      if (!existsSync(resolvedWorkdir)) {
        return JSON.stringify({ ok: false, reason: "workdir not found", workdir: resolvedWorkdir }, null, 2);
      }

      try {
        const stat = statSync(resolvedWorkdir);
        if (!stat.isDirectory()) {
          return JSON.stringify({ ok: false, reason: "workdir is not a directory", workdir: resolvedWorkdir }, null, 2);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ ok: false, reason: message, workdir: resolvedWorkdir }, null, 2);
      }

      if (options?.policyEvaluator) {
        const decision = options.policyEvaluator(command);
        if (!decision.allow) {
          return JSON.stringify({ ok: false, reason: decision.reason ?? "denied by policy" }, null, 2);
        }
      }

      const timeoutMs = normalizeTimeout(firstNumber(input, ["timeout", "timeout_ms", "timeoutMs"]));

      const invocation = resolveAegisBashInvocation(command);

      const child = spawn(invocation.command, invocation.args, {
        cwd: resolvedWorkdir,
        env: buildFilteredEnv(options?.envAllowlist),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (!child.killed) {
          child.kill();
        }
      }, timeoutMs);

      const collect = async (stream: NodeJS.ReadableStream | null): Promise<string> => {
        if (!stream) {
          return "";
        }
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return truncate(Buffer.concat(chunks).toString("utf-8"));
      };

      try {
        const exitCodePromise = new Promise<number>((resolveExit) => {
          child.once("close", (code) => resolveExit(typeof code === "number" ? code : 1));
          child.once("error", () => resolveExit(127));
        });

        const [stdout, stderr, exitCode] = await Promise.all([
          collect(child.stdout),
          collect(child.stderr),
          exitCodePromise,
        ]);

        if (!timedOut && exitCode === 0) {
          const successOutput = stdout || stderr;
          return successOutput;
        }

        return JSON.stringify(
          {
            ok: false,
            timedOut,
            exitCode,
            workdir: resolvedWorkdir,
            stdout,
            stderr,
          },
          null,
          2,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ ok: false, reason: message, workdir: resolvedWorkdir }, null, 2);
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
