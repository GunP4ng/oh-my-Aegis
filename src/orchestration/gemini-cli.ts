import { spawn as spawnNode } from "node:child_process";
import { extname, resolve } from "node:path";

import { isRecord } from "../utils/is-record";
import { safeJsonParse } from "../utils/json";

export type PatchProposalEnvelope = {
  schema_version: 1;
  contract: "sandbox_patch_proposal";
  worker: "gemini_cli";
  run_id: string;
  manifest_ref: string;
  patch_diff_ref: string;
  sandbox_cwd: string;
  response_text: string;
};

export type PatchProposalContext = {
  sandbox_cwd: string;
  run_id: string;
  manifest_ref: string;
  patch_diff_ref: string;
};

export type GeminiCliResult = {
  ok: boolean;
  reason?: string;
  response_text?: string;
  proposal_envelope?: PatchProposalEnvelope;
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

function parseProposalContext(input: PatchProposalContext | undefined):
  | { ok: true; value: PatchProposalContext }
  | { ok: false; reason: string } {
  if (!input) {
    return {
      ok: false,
      reason: "missing required proposal context: sandbox_cwd, run_id, manifest_ref, patch_diff_ref",
    };
  }

  const sandboxCwd = typeof input.sandbox_cwd === "string" ? input.sandbox_cwd.trim() : "";
  const runID = typeof input.run_id === "string" ? input.run_id.trim() : "";
  const manifestRef = typeof input.manifest_ref === "string" ? input.manifest_ref.trim() : "";
  const patchDiffRef = typeof input.patch_diff_ref === "string" ? input.patch_diff_ref.trim() : "";

  const missing: string[] = [];
  if (!sandboxCwd) missing.push("sandbox_cwd");
  if (!runID) missing.push("run_id");
  if (!manifestRef) missing.push("manifest_ref");
  if (!patchDiffRef) missing.push("patch_diff_ref");
  if (missing.length > 0) {
    return { ok: false, reason: `missing required proposal context: ${missing.join(", ")}` };
  }

  const normalizedCwd = resolve(sandboxCwd);
  const normalized = normalizedCwd.split("\\").join("/");
  if (!normalized.includes("/.Aegis/runs/") || !normalized.endsWith("/sandbox")) {
    return {
      ok: false,
      reason: `fails closed: sandbox cwd mismatch (expected .Aegis run sandbox path, got '${normalizedCwd}')`,
    };
  }

  return {
    ok: true,
    value: {
      sandbox_cwd: normalizedCwd,
      run_id: runID,
      manifest_ref: manifestRef,
      patch_diff_ref: patchDiffRef,
    },
  };
}

function buildProposalPrompt(prompt: string): string {
  return [
    "PATCH_PROPOSAL_MODE: sandbox-only",
    "Return a proposal only. Do not apply edits, run mutating commands, or suggest direct workspace mutation.",
    "Output must be the proposed patch plan/content only.",
    "---",
    prompt,
  ].join("\n");
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
  const isWin = process.platform === "win32";
  const ext = extname(params.bin).toLowerCase();
  const shouldWrapNode = isWin && (ext === ".js" || ext === ".mjs" || ext === ".cjs");
  const actualBin = shouldWrapNode ? "node" : params.bin;
  const actualArgs = shouldWrapNode ? [params.bin, ...params.args] : params.args;

  const child = params.deps.spawnImpl(actualBin, actualArgs, {
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
  env?: NodeJS.ProcessEnv;
  proposal_context?: PatchProposalContext;
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

  const parsedContext = parseProposalContext(params.proposal_context);
  if (!parsedContext.ok) {
    return { ok: false, reason: parsedContext.reason };
  }

  const proposalContext = parsedContext.value;

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

  const cwd = proposalContext.sandbox_cwd;

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
  const missing: string[] = [];
  if (!caps.hasOutputFormat) missing.push("--output-format");
  if (!caps.hasApprovalMode) missing.push("--approval-mode");
  if (!caps.hasApprovalModePlanSupport) missing.push("--approval-mode plan");
  if (!caps.hasSandboxFlag) missing.push("--sandbox");
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Gemini CLI is missing required safe flags: ${missing.join(", ")}. Upgrade Gemini CLI.`,
      stdout: helpText,
    };
  }

  const args: string[] = ["--output-format", "json", "--approval-mode", "plan", "--sandbox", "true"];
  const model = typeof params.model === "string" ? params.model.trim() : "";
  if (model && caps.hasModelFlag) {
    args.push("--model", model);
  }
  if (caps.hasPromptFlag) {
    args.push("--prompt", buildProposalPrompt(prompt));
  } else {
    args.push(buildProposalPrompt(prompt));
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
  const proposalEnvelope: PatchProposalEnvelope = {
    schema_version: 1,
    contract: "sandbox_patch_proposal",
    worker: "gemini_cli",
    run_id: proposalContext.run_id,
    manifest_ref: proposalContext.manifest_ref,
    patch_diff_ref: proposalContext.patch_diff_ref,
    sandbox_cwd: proposalContext.sandbox_cwd,
    response_text: responseText,
  };

  return {
    ok: run.exitCode === 0,
    reason: run.exitCode === 0 ? undefined : `gemini exited with code ${run.exitCode}`,
    response_text: responseText,
    proposal_envelope: proposalEnvelope,
    exit_code: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    raw,
    stats: isRecord(parsed) ? (parsed as Record<string, unknown>).stats : undefined,
  };
}
