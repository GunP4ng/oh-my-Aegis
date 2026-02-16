import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runClaudeHook } from "../src/hooks/claude-compat";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

describe("claude-compat", () => {
  it("closes stdin so hooks that read until EOF do not hang", async () => {
    const root = join(tmpdir(), `aegis-claude-hook-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    roots.push(root);

    const hooksDir = join(root, ".claude", "hooks");
    mkdirSync(hooksDir, { recursive: true });

    const scriptPath = join(hooksDir, "PreToolUse.sh");
    writeFileSync(
      scriptPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "cat >/dev/null",
        "exit 0",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = await runClaudeHook({
      projectDir: root,
      hookName: "PreToolUse",
      payload: { tool: "read" },
      timeoutMs: 1500,
    });

    expect(result.ok).toBe(true);
  });
});
