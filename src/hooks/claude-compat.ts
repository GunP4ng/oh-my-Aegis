import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

export async function runClaudeHook(params: {
  projectDir: string;
  hookName: "PreToolUse" | "PostToolUse";
  payload: Record<string, unknown>;
  timeoutMs: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const hooksDir = join(params.projectDir, ".claude", "hooks");
  const candidates = [
    join(hooksDir, `${params.hookName}.sh`),
    join(hooksDir, `${params.hookName}.bash`),
  ];
  const script = candidates.find((p) => existsSync(p) && isFile(p));
  if (!script) {
    return { ok: true as const };
  }

  const input = `${JSON.stringify(params.payload)}\n`;
  const proc = spawn("bash", [script], {
    cwd: params.projectDir,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const maxWaitMs = Math.max(10, params.timeoutMs);

  try {
    proc.stdin.write(input);
    proc.stdin.end();
  } catch (error) {
    void error;
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  proc.stdout?.on("data", (chunk) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  proc.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  type ExitResult = { code: number; error: Error | null; timedOut: boolean };
  const exited = new Promise<ExitResult>((resolveExit) => {
    proc.once("close", (code) => {
      resolveExit({ code: typeof code === "number" ? code : 1, error: null, timedOut: false });
    });
    proc.once("error", (error) => {
      resolveExit({ code: 127, error: error instanceof Error ? error : new Error(String(error)), timedOut: false });
    });
  });
  const timed = new Promise<ExitResult>((resolveTimeout) => {
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch (error) {
        void error;
      }
      resolveTimeout({ code: 124, error: null, timedOut: true });
    }, maxWaitMs);
    proc.once("close", () => clearTimeout(timer));
    proc.once("error", () => clearTimeout(timer));
  });

  const exit = await Promise.race([exited, timed]);
  const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
  const stderr = Buffer.concat(stderrChunks).toString("utf-8");

  if (exit.error) {
    const errno = exit.error as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      return { ok: true as const };
    }
    return {
      ok: false as const,
      reason: `Claude hook ${params.hookName} failed to spawn bash: ${exit.error.message}`,
    };
  }

  if (exit.timedOut) {
    return {
      ok: false as const,
      reason: `Claude hook ${params.hookName} timed out after ${maxWaitMs}ms.`,
    };
  }

  const exitCode = exit.code;

  if (exitCode === 0) {
    return { ok: true as const };
  }

  const msg = [
    `Claude hook ${params.hookName} denied (exit=${exitCode})`,
    stderr.trim() ? `stderr: ${truncate(stderr.trim(), 1200)}` : "",
    stdout.trim() ? `stdout: ${truncate(stdout.trim(), 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { ok: false as const, reason: msg };
}
