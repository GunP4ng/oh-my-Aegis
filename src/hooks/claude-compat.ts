import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

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
  const proc = Bun.spawn(["bash", script], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
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
  } catch (error) {
    void error;
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text().catch(() => ""),
    new Response(proc.stderr).text().catch(() => ""),
    proc.exited,
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
