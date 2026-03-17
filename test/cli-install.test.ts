import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __setInstallPluginPackageSyncForTests, runInstall } from "../src/cli/install";

const roots: string[] = [];
const originalEnv = { ...process.env };
const originalStdinIsTTY = process.stdin.isTTY;
const originalStdoutIsTTY = process.stdout.isTTY;

afterEach(() => {
  __setInstallPluginPackageSyncForTests(null);
  process.env = { ...originalEnv };
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalStdinIsTTY });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalStdoutIsTTY });
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function makeRoot(): string {
  const root = join(tmpdir(), `aegis-cli-install-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  return root;
}

function captureWrites(run: () => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
    return true;
  }) as typeof process.stderr.write;

  return run()
    .then((code) => ({ code, stdout, stderr }))
    .finally(() => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    });
}

describe("cli install", () => {
  it("ensures gemini auth plugin plus google/anthropic catalogs when gemini and claude are enabled", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });

    const opencodePath = join(opencodeDir, "opencode.json");
    writeFileSync(opencodePath, `${JSON.stringify({ plugin: ["existing-plugin"] }, null, 2)}\n`, "utf-8");

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    };
    __setInstallPluginPackageSyncForTests((_dir, specs) => specs);

    const { code, stdout, stderr } = await captureWrites(() =>
      runInstall(["--no-tui", "--gemini=yes", "--claude=yes", "--chatgpt=no"])
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");

    const installedOpencode = JSON.parse(readFileSync(opencodePath, "utf-8")) as {
      plugin?: unknown;
      provider?: unknown;
    };
    const plugins = Array.isArray(installedOpencode.plugin) ? installedOpencode.plugin : [];
    expect(plugins).toContain("oh-my-aegis@latest");
    expect(plugins.some((p) => typeof p === "string" && p.startsWith("opencode-gemini-auth@"))).toBe(true);
    expect(plugins.some((p) => typeof p === "string" && p.startsWith("opencode-antigravity-auth@"))).toBe(false);

    const provider =
      installedOpencode.provider && typeof installedOpencode.provider === "object"
        ? (installedOpencode.provider as Record<string, unknown>)
        : {};
    expect(Object.prototype.hasOwnProperty.call(provider, "google")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(provider, "anthropic")).toBe(true);
    expect(stdout).toContain("- Gemini OAuth integration: enabled");
    expect(stdout).toContain("- Gemini auth: run `opencode auth login`, choose Google -> OAuth with Google (Gemini CLI)");
    expect(plugins.some((p) => typeof p === "string" && p.startsWith("opencode-cluade-auth@"))).toBe(true);
    expect(stdout).toContain("- Claude Code CLI integration: enabled via opencode-cluade-auth");
    expect(stdout).toContain("- ensured provider catalogs: google, anthropic");
  });

  it("uses opencode-aegis as the default config root on fresh install", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    };
    __setInstallPluginPackageSyncForTests((_dir, specs) => specs);

    const { code, stdout, stderr } = await captureWrites(() =>
      runInstall(["--no-tui", "--gemini=yes", "--claude=no", "--chatgpt=no"])
    );

    const opencodePath = join(xdg, "opencode-aegis", "opencode", "opencode.json");

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(existsSync(opencodePath)).toBe(true);
    expect(stdout).toContain(`- OpenCode config updated: ${opencodePath}`);
  });

  it("can disable gemini and claude integrations entirely", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });

    const opencodePath = join(opencodeDir, "opencode.json");
    writeFileSync(opencodePath, `${JSON.stringify({ plugin: ["existing-plugin"] }, null, 2)}\n`, "utf-8");

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    };
    __setInstallPluginPackageSyncForTests((_dir, specs) => specs);

    const { code, stdout, stderr } = await captureWrites(() =>
      runInstall(["--no-tui", "--gemini=no", "--claude=no", "--chatgpt=no"])
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("- gemini auth plugin: skipped by install options");
    expect(stdout).toContain("- Gemini OAuth integration: disabled");
    expect(stdout).toContain("- Claude provider integration: disabled");
    expect(stdout).toContain("- ensured provider catalogs: (none)");
  });

  it("uses configured local claude auth plugin entry when claude is enabled", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });

    const opencodePath = join(opencodeDir, "opencode.json");
    writeFileSync(opencodePath, `${JSON.stringify({ plugin: ["existing-plugin"] }, null, 2)}\n`, "utf-8");

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
      AEGIS_CLAUDE_AUTH_PLUGIN_ENTRY: "/tmp/opencode-cluade-auth/dist/index.js",
    };
    __setInstallPluginPackageSyncForTests((_dir, specs) => specs);

    const { code, stdout, stderr } = await captureWrites(() =>
      runInstall(["--no-tui", "--gemini=no", "--claude=yes", "--chatgpt=no"])
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");

    const installedOpencode = JSON.parse(readFileSync(opencodePath, "utf-8")) as { plugin?: unknown };
    const plugins = Array.isArray(installedOpencode.plugin) ? installedOpencode.plugin : [];
    expect(plugins).toContain("/tmp/opencode-cluade-auth/dist/index.js");
    expect(stdout).toContain("- claude auth plugin ensured: /tmp/opencode-cluade-auth/dist/index.js");
    expect(stdout).toContain("- Claude Code CLI integration: enabled via opencode-cluade-auth");
  });

  it("treats legacy gemini_cli installs as gemini-enabled during update flow", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });

    const opencodePath = join(opencodeDir, "opencode.json");
    writeFileSync(
      opencodePath,
      `${JSON.stringify({ plugin: ["oh-my-aegis@latest"], provider: { gemini_cli: { models: {} } } }, null, 2)}\n`,
      "utf-8"
    );

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    };
    __setInstallPluginPackageSyncForTests((_dir, specs) => specs);

    const { code, stdout, stderr } = await captureWrites(() => runInstall(["--no-tui", "--chatgpt=no"]));

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("oh-my-Aegis update start.");
    expect(stdout).toContain("- Gemini OAuth integration: enabled");
    expect(stdout).toContain("- ensured provider catalogs: google, anthropic");
  });

  it("does not invoke external CLI bootstrap even when --bootstrap=yes is requested", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(join(opencodeDir, "opencode.json"), `${JSON.stringify({ plugin: [] }, null, 2)}\n`, "utf-8");

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    };
    __setInstallPluginPackageSyncForTests((_dir, specs) => specs);

    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });

    const { code, stdout, stderr } = await captureWrites(() =>
      runInstall(["--chatgpt=no", "--gemini=yes", "--claude=yes", "--bootstrap=yes"])
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("- bootstrap note: no extra provider CLI install is performed in this setup; authenticate Gemini via `opencode auth login`");
  });
});
