import { spawn as spawnNode } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { isRecord } from "../utils/is-record";
import { safeJsonParse } from "../utils/json";

export type GeminiCliResult = {
  ok: boolean;
  reason?: string;
  response_text?: string;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  raw?: unknown;
  stats?: unknown;
};

export type GeminiCliDeps = {
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
  hasOutputFormat: boolean;
  hasApprovalMode: boolean;
  hasApprovalModePlanSupport: boolean;
  hasPromptFlag: boolean;
  hasModelFlag: boolean;
  hasSandboxFlag: boolean;
  mentionsJsonOutput: boolean;
} {
  const text = helpText || "";
  const lines = text.split(/\r?\n/);
  const approvalModeLine = lines.find((line) => /\B--approval-mode\b/i.test(line)) ?? "";
  return {
    hasOutputFormat: /\B--output-format\b/.test(text),
    hasApprovalMode: /\B--approval-mode\b/.test(text),
    hasApprovalModePlanSupport: /plan/i.test(approvalModeLine),
    hasPromptFlag: /\B--prompt\b/.test(text),
    hasModelFlag: /\B--model\b/.test(text),
    hasSandboxFlag: /\B--sandbox\b/.test(text),
    mentionsJsonOutput: /\bjson\b/i.test(text) && /output-format/i.test(text),
  };
}

async function collectStream(stream: NodeJS.ReadableStream | null, maxChars: number): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: "", truncated: false };
  const chunks: Buffer[] = [];
  let total = 0;
  const hardMax = Math.max(1_000, maxChars);
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buf);
    total += buf.length;
    if (total >= hardMax * 2) {
      break;
    }
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
  deps: Required<Pick<GeminiCliDeps, "spawnImpl" | "nowMs">>;
}): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
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
  const killer = () => {
    try {
      if (!child.killed) {
        child.kill();
      }
    } catch {
    }
  };

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
  return { exitCode, stdout: stdoutCollected.text, stderr: stderrCollected.text, timedOut };
}

export async function runGeminiCli(params: {
  prompt: string;
  model?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  deps?: GeminiCliDeps;
}): Promise<GeminiCliResult> {
  const env = params.env ?? process.env;
  const deps: Required<Pick<GeminiCliDeps, "spawnImpl" | "nowMs">> = {
    spawnImpl: params.deps?.spawnImpl ?? spawnNode,
    nowMs: params.deps?.nowMs ?? (() => Date.now()),
  };

  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  if (!prompt) {
    return { ok: false, reason: "prompt is required" };
  }

  const bin = nonEmpty(env.AEGIS_GEMINI_CLI_BIN) ? env.AEGIS_GEMINI_CLI_BIN.trim() : "gemini";
  const timeoutMsRaw = nonEmpty(env.AEGIS_GEMINI_CLI_TIMEOUT_MS) ? Number(env.AEGIS_GEMINI_CLI_TIMEOUT_MS) : undefined;
  const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : Number.isFinite(timeoutMsRaw) ? Math.floor(timeoutMsRaw as number) : 60_000;
  const maxOutputCharsRaw = nonEmpty(env.AEGIS_GEMINI_CLI_MAX_OUTPUT_CHARS) ? Number(env.AEGIS_GEMINI_CLI_MAX_OUTPUT_CHARS) : undefined;
  const maxOutputChars =
    typeof params.maxOutputChars === "number"
      ? Math.max(500, Math.floor(params.maxOutputChars))
      : Number.isFinite(maxOutputCharsRaw)
        ? Math.max(500, Math.floor(maxOutputCharsRaw as number))
        : 20_000;

  const baseCwd =
    typeof params.cwd === "string" && params.cwd.trim().length > 0
      ? params.cwd.trim()
      : nonEmpty(env.AEGIS_GEMINI_CLI_CWD)
        ? env.AEGIS_GEMINI_CLI_CWD.trim()
        : tmpdir();
  let cwd = resolve(join(baseCwd, `aegis-gemini-cli-${randomUUID()}`));
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
    helpText = `${help.stdout}\n${help.stderr}`.trim();
    if (help.exitCode !== 0) {
      return {
        ok: false,
        reason: `gemini --help failed (exit=${help.exitCode}). Ensure Gemini CLI is installed and runnable.`,
        exit_code: help.exitCode,
        stdout: help.stdout,
        stderr: help.stderr,
      };
    }
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    const msg = e instanceof Error ? e.message : String(error);
    if (e && e.code === "ENOENT") {
      return { ok: false, reason: `Gemini CLI binary not found: ${bin}. Install Gemini CLI (command: gemini).`, exit_code: 127 };
    }
    return { ok: false, reason: `Failed to spawn gemini --help: ${msg}`, exit_code: 127 };
  }

  const caps = parseHelpCapabilities(helpText);
  if (!caps.hasOutputFormat || !caps.hasApprovalMode || !caps.hasApprovalModePlanSupport) {
    return {
      ok: false,
      reason:
        "Gemini CLI must support --output-format json and --approval-mode plan. Upgrade Gemini CLI to a version that supports --approval-mode plan.",
      stdout: helpText,
    };
  }

  const args: string[] = ["--output-format", "json", "--approval-mode", "plan"];
  const model = typeof params.model === "string" ? params.model.trim() : "";
  if (model && caps.hasModelFlag) {
    args.push("--model", model);
  }
  if (caps.hasPromptFlag) {
    args.push("--prompt", prompt);
  } else {
    args.push(prompt);
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
      return { ok: false, reason: `Gemini CLI binary not found: ${bin}. Install Gemini CLI (command: gemini).`, exit_code: 127 };
    }
    return { ok: false, reason: `Failed to spawn gemini: ${msg}`, exit_code: 127 };
  }

  if (run.timedOut) {
    return {
      ok: false,
      reason: `Gemini CLI timed out after ${timeoutMs}ms.`,
      exit_code: 124,
      stdout: run.stdout,
      stderr: run.stderr,
    };
  }

  if (run.stderr.includes('Approval mode "plan" is only available when experimental.plan is enabled.')) {
    return {
      ok: false,
      reason:
        'Gemini CLI approval-mode=plan requires experimental.plan=true. Set it in ~/.gemini/settings.json: {"experimental":{"plan":true}}',
      exit_code: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
    };
  }

  const parsed = safeJsonParse(run.stdout.trim());
  if (!parsed) {
    return {
      ok: false,
      reason: "invalid JSON output",
      exit_code: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
    };
  }

  const raw = parsed;
  if (isRecord(parsed) && isRecord(parsed.error)) {
    const err = parsed.error as Record<string, unknown>;
    const message = typeof err.message === "string" ? err.message : "Gemini CLI error";
    return {
      ok: false,
      reason: message,
      exit_code: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      raw,
      stats: (parsed as Record<string, unknown>).stats,
    };
  }

  const responseText =
    isRecord(parsed) && typeof (parsed as Record<string, unknown>).response === "string"
      ? ((parsed as Record<string, unknown>).response as string)
      : "";

  return {
    ok: run.exitCode === 0,
    reason: run.exitCode === 0 ? undefined : `gemini exited with code ${run.exitCode}`,
    response_text: responseText,
    exit_code: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    raw,
    stats: isRecord(parsed) ? (parsed as Record<string, unknown>).stats : undefined,
  };
}
