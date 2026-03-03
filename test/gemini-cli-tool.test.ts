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
  const root = join(tmpdir(), `aegis-gemini-cli-tool-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

function createFakeGeminiBin(projectDir: string): string {
  const fakeGeminiBin = join(projectDir, "fake-gemini.js");
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write("gemini cli help\\n--output-format json\\n--approval-mode [plan|auto]\\n--prompt\\n--model\\n");
  process.exit(0);
}

if (process.env.AEGIS_FAKE_GEMINI_ERROR === "1") {
  process.stdout.write(JSON.stringify({ error: { message: "boom" } }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({ response: "hello" }));
process.exit(0);
`;
  writeFileSync(fakeGeminiBin, script, "utf-8");
  chmodSync(fakeGeminiBin, 0o755);
  return fakeGeminiBin;
}

describe("ctf_gemini_cli tool", () => {
  it("is registered and returns structured JSON using fake gemini binary", async () => {
    const { projectDir } = setup();
    const fakeGeminiBin = createFakeGeminiBin(projectDir);
    process.env.AEGIS_GEMINI_CLI_BIN = fakeGeminiBin;

    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const tool = (hooks as any)?.tool?.ctf_gemini_cli;
    expect(typeof tool?.execute).toBe("function");

    const outRaw = await tool.execute({ prompt: "hi" }, { sessionID: "s1" });
    const parsed = JSON.parse(outRaw) as { ok?: boolean; response_text?: string; sessionID?: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.response_text).toBe("hello");
    expect(parsed.sessionID).toBe("s1");
  });

  it("returns structured tool error from fake gemini binary", async () => {
    const { projectDir } = setup();
    const fakeGeminiBin = createFakeGeminiBin(projectDir);
    process.env.AEGIS_GEMINI_CLI_BIN = fakeGeminiBin;
    process.env.AEGIS_FAKE_GEMINI_ERROR = "1";

    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const tool = (hooks as any)?.tool?.ctf_gemini_cli;
    expect(typeof tool?.execute).toBe("function");

    const outRaw = await tool.execute({ prompt: "hi" }, { sessionID: "s1" });
    const parsed = JSON.parse(outRaw) as { ok?: boolean; reason?: string; sessionID?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("boom");
    expect(parsed.sessionID).toBe("s1");
  });
});
