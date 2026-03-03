import { spawn as spawnNode } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type ClaudeCodeCliResult = {
  ok: boolean;
  reason?: string;
  response_text?: string;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
};

export type ClaudeCodeCliDeps = {
  spawnImpl?: typeof spawnNode;
  nowMs?: () => number;
};

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (maxChars <= 0) return { text: "", truncated: text.length > 0 };
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseHelpCapabilities(helpText: string): {
  hasPrintFlag: boolean;
  hasOutputFormat: boolean;
  hasPermissionMode: boolean;
  hasPermissionModePlanSupport: boolean;
  hasToolsFlag: boolean;
  hasNoSessionPersistenceFlag: boolean;
  hasModelFlag: boolean;
} {
  const text = helpText || "";
  const lines = text.split(/\r?\n/);
  const permissionModeLine = lines.find((line) => /\B--permission-mode\b/i.test(line)) ?? "";

  return {
    hasPrintFlag: /(^|\s)-p(\s|,|$)|\B--print\b/i.test(text),
    hasOutputFormat: /\B--output-format\b/i.test(text),
    hasPermissionMode: /\B--permission-mode\b/i.test(text),
    hasPermissionModePlanSupport: /\bplan\b/i.test(permissionModeLine),
    hasToolsFlag: /\B--tools\b/i.test(text),
    hasNoSessionPersistenceFlag: /\B--no-session-persistence\b/i.test(text),
    hasModelFlag: /\B--model\b/i.test(text),
  };
}

async function collectStream(stream: NodeJS.ReadableStream | null, maxChars: number): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: "", truncated: false };

  const chunks: Buffer[] = [];
  let total = 0;
  const hardMax = Math.max(1_000, maxChars);

  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      total += buf.length;
      if (total >= hardMax * 2) {
        break;
      }
    }
  } catch {
  }

  const text = Buffer.concat(chunks).toString("utf-8");
  return truncate(text, maxChars);
}

async function spawnAndCollect(params: {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputChars: number;
  deps: Required<Pick<ClaudeCodeCliDeps, "spawnImpl" | "nowMs">>;
}): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean; spawnErrorCode?: string }> {
  const child = params.deps.spawnImpl(params.bin, params.args, {
    cwd: params.cwd,
    env: {
      ...params.env,
      CI: "true",
      NO_COLOR: "1",
      TERM: "dumb",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let timedOut = false;
  let spawnErrorCode: string | undefined;
  const killer = () => {
    try {
      if (!child.killed) {
        child.kill();
      }
    } catch {
    }
  };

  child.once("error", (err) => {
    const e = err as NodeJS.ErrnoException;
    spawnErrorCode = typeof e?.code === "string" ? e.code : undefined;
    child.stdout?.destroy();
    child.stderr?.destroy();
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    killer();
  }, Math.max(100, params.timeoutMs));

  const exited = new Promise<number>((resolveExit) => {
    child.once("close", (code) => {
      resolveExit(typeof code === "number" ? code : 1);
    });
    child.once("error", () => {
      resolveExit(127);
    });
  });

  const [stdoutCollected, stderrCollected, exitCode] = await Promise.all([
    collectStream(child.stdout, params.maxOutputChars),
    collectStream(child.stderr, params.maxOutputChars),
    exited,
  ]);

  clearTimeout(timeout);
  return {
    exitCode,
    stdout: stdoutCollected.text,
    stderr: stderrCollected.text,
    timedOut,
    spawnErrorCode,
  };
}

export async function runClaudeCodeCli(params: {
  prompt: string;
  model?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  deps?: ClaudeCodeCliDeps;
}): Promise<ClaudeCodeCliResult> {
  const env = params.env ?? process.env;
  const deps: Required<Pick<ClaudeCodeCliDeps, "spawnImpl" | "nowMs">> = {
    spawnImpl: params.deps?.spawnImpl ?? spawnNode,
    nowMs: params.deps?.nowMs ?? (() => Date.now()),
  };

  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  if (!prompt) {
    return { ok: false, reason: "prompt is required" };
  }

  const bin = nonEmpty(env.AEGIS_CLAUDE_CODE_CLI_BIN) ? env.AEGIS_CLAUDE_CODE_CLI_BIN.trim() : "claude";
  const timeoutMs = typeof params.timeoutMs === "number" ? Math.max(100, Math.floor(params.timeoutMs)) : 60_000;
  const maxOutputChars =
    typeof params.maxOutputChars === "number"
      ? Math.max(500, Math.floor(params.maxOutputChars))
      : 20_000;

  const baseCwd = typeof params.cwd === "string" && params.cwd.trim().length > 0 ? params.cwd.trim() : tmpdir();
  let cwd = resolve(join(baseCwd, `aegis-claude-code-cli-${randomUUID()}`));
  try {
    mkdirSync(cwd, { recursive: true });
  } catch {
    cwd = resolve(baseCwd);
  }

  let helpText = "";
  try {
    const help = await spawnAndCollect({
      bin,
      args: ["--help"],
      cwd,
      env,
      timeoutMs: Math.min(timeoutMs, 10_000),
      maxOutputChars,
      deps,
    });

    if (help.timedOut) {
      return {
        ok: false,
        reason: `claude --help timed out after ${Math.min(timeoutMs, 10_000)}ms.`,
        exit_code: 124,
        stdout: help.stdout,
        stderr: help.stderr,
      };
    }

    helpText = `${help.stdout}\n${help.stderr}`.trim();
    if (help.exitCode !== 0) {
      if (help.spawnErrorCode === "ENOENT") {
        return {
          ok: false,
          reason: `Claude Code CLI binary not found: ${bin}. Install Claude Code CLI (command: claude).`,
          exit_code: 127,
          stdout: help.stdout,
          stderr: help.stderr,
        };
      }
      return {
        ok: false,
        reason: `claude --help failed (exit=${help.exitCode}). Ensure Claude Code CLI is installed and runnable.`,
        exit_code: help.exitCode,
        stdout: help.stdout,
        stderr: help.stderr,
      };
    }
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    const msg = e instanceof Error ? e.message : String(error);
    if (e && e.code === "ENOENT") {
      return {
        ok: false,
        reason: `Claude Code CLI binary not found: ${bin}. Install Claude Code CLI (command: claude).`,
        exit_code: 127,
      };
    }
    return { ok: false, reason: `Failed to spawn claude --help: ${msg}`, exit_code: 127 };
  }

  const caps = parseHelpCapabilities(helpText);
  const missing: string[] = [];
  if (!caps.hasPrintFlag) missing.push("-p/--print");
  if (!caps.hasOutputFormat) missing.push("--output-format");
  if (!caps.hasPermissionMode) missing.push("--permission-mode");
  if (!caps.hasPermissionModePlanSupport) missing.push("--permission-mode plan");
  if (!caps.hasToolsFlag) missing.push("--tools");
  if (!caps.hasNoSessionPersistenceFlag) missing.push("--no-session-persistence");

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Claude Code CLI is missing required safe flags: ${missing.join(", ")}. Upgrade Claude Code CLI.`,
      stdout: helpText,
    };
  }

  const args: string[] = [
    "-p",
    prompt,
    "--output-format",
    "text",
    "--permission-mode",
    "plan",
    "--tools",
    "",
    "--no-session-persistence",
  ];

  const model = typeof params.model === "string" ? params.model.trim() : "";
  if (model && caps.hasModelFlag) {
    args.push("--model", model);
  }

  let run: Awaited<ReturnType<typeof spawnAndCollect>>;
  try {
    run = await spawnAndCollect({
      bin,
      args,
      cwd,
      env,
      timeoutMs,
      maxOutputChars,
      deps,
    });
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    const msg = e instanceof Error ? e.message : String(error);
    if (e && e.code === "ENOENT") {
      return {
        ok: false,
        reason: `Claude Code CLI binary not found: ${bin}. Install Claude Code CLI (command: claude).`,
        exit_code: 127,
      };
    }
    return { ok: false, reason: `Failed to spawn claude: ${msg}`, exit_code: 127 };
  }

  if (run.timedOut) {
    return {
      ok: false,
      reason: `Claude Code CLI timed out after ${timeoutMs}ms.`,
      exit_code: 124,
      stdout: run.stdout,
      stderr: run.stderr,
    };
  }

  if (run.spawnErrorCode === "ENOENT") {
    return {
      ok: false,
      reason: `Claude Code CLI binary not found: ${bin}. Install Claude Code CLI (command: claude).`,
      exit_code: 127,
      stdout: run.stdout,
      stderr: run.stderr,
    };
  }

  const responseText = run.stdout.trim();
  return {
    ok: run.exitCode === 0,
    reason: run.exitCode === 0 ? undefined : `claude exited with code ${run.exitCode}`,
    response_text: responseText,
    exit_code: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
  };
}
