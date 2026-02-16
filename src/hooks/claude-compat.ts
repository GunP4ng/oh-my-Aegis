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

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch (error) {
      void error;
    }
  }, Math.max(10, params.timeoutMs));

  try {
    proc.stdin.write(input);
    proc.stdin.end();
  } catch (error) {
    void error;
  }

  const collect = async (stream: NodeJS.ReadableStream | null): Promise<string> => {
    if (!stream) return "";
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8");
  };

  const exited = new Promise<number>((resolveExit) => {
    proc.once("close", (code) => {
      resolveExit(typeof code === "number" ? code : 1);
    });
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    collect(proc.stdout),
    collect(proc.stderr),
    exited,
  ]);

  clearTimeout(timer);

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
