import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import OhMyAegisPlugin from "../src/index";

const roots: string[] = [];
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function setup(): { projectDir: string } {
  const root = join(tmpdir(), `aegis-claude-code-cli-tool-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);

  const homeDir = join(root, "home");
  const projectDir = join(root, "project");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  process.env = { ...originalEnv, HOME: homeDir };
  delete process.env.XDG_CONFIG_HOME;

  const opencodeDir = join(homeDir, ".config", "opencode");
  mkdirSync(opencodeDir, { recursive: true });

  writeFileSync(
    join(opencodeDir, "oh-my-Aegis.json"),
    `${JSON.stringify({ enabled: true, default_mode: "BOUNTY", enforce_mode_header: false }, null, 2)}\n`,
    "utf-8"
  );
  writeFileSync(
    join(opencodeDir, "opencode.json"),
    `${JSON.stringify({ agent: {} }, null, 2)}\n`,
    "utf-8"
  );

  return { projectDir };
}

function createFakeClaudeBin(projectDir: string): string {
  const fakeClaudeBin = join(projectDir, "fake-claude.js");
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write("claude help\\n-p, --print\\n--output-format text\\n--permission-mode <mode> (plan, auto, bypass)\\n--tools <list>\\n--no-session-persistence\\n--max-turns <n>\\n--model <id>\\n");
  process.exit(0);
}

if (process.env.AEGIS_FAKE_CLAUDE_FAIL === "1") {
  process.stderr.write("simulated failure\\n");
  process.exit(42);
}

process.stdout.write("hello from claude");
process.exit(0);
`;
  writeFileSync(fakeClaudeBin, script, "utf-8");
  chmodSync(fakeClaudeBin, 0o755);
  return fakeClaudeBin;
}

describe("ctf_claude_code tool", () => {
  it("is registered and returns structured JSON using fake claude binary", async () => {
    const { projectDir } = setup();
    const fakeClaudeBin = createFakeClaudeBin(projectDir);
    process.env.AEGIS_CLAUDE_CODE_CLI_BIN = fakeClaudeBin;

    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const tool = (hooks as any)?.tool?.ctf_claude_code;
    expect(typeof tool?.execute).toBe("function");

    const outRaw = await tool.execute({ prompt: "hi" }, { sessionID: "s1" });
    const parsed = JSON.parse(outRaw) as { ok?: boolean; response_text?: string; sessionID?: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.response_text).toBe("hello from claude");
    expect(parsed.sessionID).toBe("s1");
  });

  it("returns non-zero exit code from fake claude binary", async () => {
    const { projectDir } = setup();
    const fakeClaudeBin = createFakeClaudeBin(projectDir);
    process.env.AEGIS_CLAUDE_CODE_CLI_BIN = fakeClaudeBin;
    process.env.AEGIS_FAKE_CLAUDE_FAIL = "1";

    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const tool = (hooks as any)?.tool?.ctf_claude_code;
    expect(typeof tool?.execute).toBe("function");

    const outRaw = await tool.execute({ prompt: "hi" }, { sessionID: "s1" });
    const parsed = JSON.parse(outRaw) as { ok?: boolean; exit_code?: number; sessionID?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.exit_code).toBe(42);
    expect(parsed.sessionID).toBe("s1");
  });
});
