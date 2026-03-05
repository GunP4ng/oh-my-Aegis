import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __setInstallCliRuntimeForTests, runInstall } from "../src/cli/install";

const roots: string[] = [];
const originalEnv = { ...process.env };
const originalStdinIsTTY = process.stdin.isTTY;
const originalStdoutIsTTY = process.stdout.isTTY;

afterEach(() => {
  process.env = { ...originalEnv };
  __setInstallCliRuntimeForTests(null);
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
  it("prints gemini/claude onboarding lines when --gemini=yes --claude=yes --chatgpt=no", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });

    const opencodePath = join(opencodeDir, "opencode.json");
    writeFileSync(opencodePath, `${JSON.stringify({ plugin: ["existing-plugin"] }, null, 2)}\n`, "utf-8");

    const configDirPackagePath = join(opencodeDir, "package.json");
    const originalConfigDirPackage = `${JSON.stringify({ name: "opencode-config-dir", dependencies: {} }, null, 2)}\n`;
    writeFileSync(configDirPackagePath, originalConfigDirPackage, "utf-8");

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    };

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
    expect(plugins.some((p) => typeof p === "string" && p.startsWith("opencode-antigravity-auth"))).toBe(false);
    expect(plugins).toContain("oh-my-aegis@latest");

    const provider =
      installedOpencode.provider && typeof installedOpencode.provider === "object"
        ? (installedOpencode.provider as Record<string, unknown>)
        : {};
    const modelCli =
      provider.model_cli && typeof provider.model_cli === "object"
        ? (provider.model_cli as Record<string, unknown>)
        : {};
    expect(modelCli.npm).toBe("@ai-sdk/openai-compatible");
    const modelCliModels =
      modelCli.models && typeof modelCli.models === "object"
        ? (modelCli.models as Record<string, unknown>)
        : {};
    expect(Object.keys(modelCliModels)).toEqual(
      expect.arrayContaining([
        "gemini-3.1-pro",
        "gemini-3-flash",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "claude-sonnet-4.6",
        "claude-opus-4.6",
        "claude-haiku-4.5",
        "claude-sonnet-4.5",
        "claude-opus-4.1",
      ])
    );

    expect(stdout).toContain("- plugin entry ensured: oh-my-aegis@latest");
    const providerCatalogLine = stdout
      .split("\n")
      .find((line) => line.startsWith("- ensured provider catalogs:"));
    expect(providerCatalogLine).toBe("- ensured provider catalogs: model_cli");
    expect(providerCatalogLine).not.toContain("openai");
    expect(stdout).toContain("- Gemini CLI integration: enabled");
    expect(stdout).toContain("- Gemini CLI setup: install `gemini` CLI, then run `gemini` once to complete login (cached login can be reused)");
    expect(stdout).toContain("- Gemini CLI auth option: set GOOGLE_GENAI_USE_GCA=true to use cached Google CLI auth");
    expect(stdout).toContain(
      "- Claude Code CLI integration: enabled (provider route available via model_cli/claude-*; tool still available)"
    );
    expect(stdout).toContain("- Claude CLI setup: install `claude` CLI, then run `claude` (or `claude login`) and follow prompts");
    expect(stdout).not.toContain("OpenCode plugin updated");
    expect(stdout).not.toContain("npm install");

    const configDirPackageAfter = readFileSync(configDirPackagePath, "utf-8");
    expect(configDirPackageAfter).toBe(originalConfigDirPackage);
  });

  it("prints no provider catalogs and no gemini/claude setup lines when --gemini=no --claude=no --chatgpt=no", async () => {
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

    const { code, stdout, stderr } = await captureWrites(() =>
      runInstall(["--no-tui", "--gemini=no", "--claude=no", "--chatgpt=no"])
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");

    const providerCatalogLine = stdout
      .split("\n")
      .find((line) => line.startsWith("- ensured provider catalogs:"));
    expect(providerCatalogLine).toBe("- ensured provider catalogs: (none)");
    expect(stdout).toContain("- Gemini CLI integration: disabled");
    expect(stdout).toContain("- Claude Code CLI integration: disabled");
    expect(stdout).not.toContain("- Gemini CLI setup:");
    expect(stdout).not.toContain("- Gemini CLI auth option:");
    expect(stdout).not.toContain("- Claude CLI setup:");
  });

  it("seeds only gemini-* model_cli models when --gemini=yes --claude=no --chatgpt=no", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });

    const opencodePath = join(opencodeDir, "opencode.json");
    writeFileSync(opencodePath, `${JSON.stringify({ plugin: [] }, null, 2)}\n`, "utf-8");

    const homeDir = join(root, "home");
    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: homeDir,
    };

    const { code, stderr } = await captureWrites(() =>
      runInstall(["--no-tui", "--gemini=yes", "--claude=no", "--chatgpt=no"])
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");

    const installedOpencode = JSON.parse(readFileSync(opencodePath, "utf-8")) as {
      provider?: unknown;
    };
    const provider =
      installedOpencode.provider && typeof installedOpencode.provider === "object"
        ? (installedOpencode.provider as Record<string, unknown>)
        : {};
    const modelCli =
      provider.model_cli && typeof provider.model_cli === "object"
        ? (provider.model_cli as Record<string, unknown>)
        : {};
    const modelCliModels =
      modelCli.models && typeof modelCli.models === "object"
        ? (modelCli.models as Record<string, unknown>)
        : {};

    expect(Object.keys(modelCliModels).sort()).toEqual([
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-3-flash",
      "gemini-3.1-pro",
    ]);
  });

  it("seeds only claude-* model_cli models and does not create Gemini settings when --gemini=no --claude=yes --chatgpt=no", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });

    const opencodePath = join(opencodeDir, "opencode.json");
    writeFileSync(opencodePath, `${JSON.stringify({ plugin: [] }, null, 2)}\n`, "utf-8");

    const homeDir = join(root, "home");
    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: homeDir,
    };

    const { code, stderr } = await captureWrites(() =>
      runInstall(["--no-tui", "--gemini=no", "--claude=yes", "--chatgpt=no"])
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");

    const installedOpencode = JSON.parse(readFileSync(opencodePath, "utf-8")) as {
      provider?: unknown;
    };
    const provider =
      installedOpencode.provider && typeof installedOpencode.provider === "object"
        ? (installedOpencode.provider as Record<string, unknown>)
        : {};
    const modelCli =
      provider.model_cli && typeof provider.model_cli === "object"
        ? (provider.model_cli as Record<string, unknown>)
        : {};
    const modelCliModels =
      modelCli.models && typeof modelCli.models === "object"
        ? (modelCli.models as Record<string, unknown>)
        : {};

    expect(Object.keys(modelCliModels).sort()).toEqual([
      "claude-haiku-4.5",
      "claude-opus-4.1",
      "claude-opus-4.6",
      "claude-sonnet-4.5",
      "claude-sonnet-4.6",
    ]);
    expect(existsSync(join(homeDir, ".gemini", "settings.json"))).toBe(false);
  });

  it("merges experimental.plan=true into existing Gemini settings without deleting other keys", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    const homeDir = join(root, "home");
    const geminiDir = join(homeDir, ".gemini");
    const geminiSettingsPath = join(geminiDir, "settings.json");
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(geminiDir, { recursive: true });
    writeFileSync(join(opencodeDir, "opencode.json"), `${JSON.stringify({ plugin: [] }, null, 2)}\n`, "utf-8");
    writeFileSync(
      geminiSettingsPath,
      `${JSON.stringify(
        {
          mcpServers: { local: { command: "node", args: ["server.js"] } },
          security: { sandbox: true },
          ui: { theme: "light" },
          general: { telemetry: false },
          experimental: { otherFlag: true },
        },
        null,
        2
      )}\n`,
      "utf-8"
    );

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: homeDir,
    };

    const { code, stderr } = await captureWrites(() => runInstall(["--no-tui", "--gemini=yes", "--claude=no", "--chatgpt=no"]));

    expect(code).toBe(0);
    expect(stderr).toBe("");

    const updated = JSON.parse(readFileSync(geminiSettingsPath, "utf-8")) as Record<string, unknown>;
    expect(updated.mcpServers).toEqual({ local: { command: "node", args: ["server.js"] } });
    expect(updated.security).toEqual({ sandbox: true });
    expect(updated.ui).toEqual({ theme: "light" });
    expect(updated.general).toEqual({ telemetry: false });
    expect(updated.experimental).toEqual({ otherFlag: true, plan: true });
  });

  it("creates Gemini settings with experimental.plan=true when settings file is missing", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    const homeDir = join(root, "home");
    const geminiSettingsPath = join(homeDir, ".gemini", "settings.json");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(join(opencodeDir, "opencode.json"), `${JSON.stringify({ plugin: [] }, null, 2)}\n`, "utf-8");

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: homeDir,
    };

    const { code, stderr } = await captureWrites(() => runInstall(["--no-tui", "--gemini=yes", "--claude=no", "--chatgpt=no"]));

    expect(code).toBe(0);
    expect(stderr).toBe("");

    const created = JSON.parse(readFileSync(geminiSettingsPath, "utf-8")) as Record<string, unknown>;
    expect(created).toEqual({ experimental: { plan: true } });
  });

  it("warns and continues when existing Gemini settings JSON is invalid", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    const homeDir = join(root, "home");
    const geminiDir = join(homeDir, ".gemini");
    const geminiSettingsPath = join(geminiDir, "settings.json");
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(geminiDir, { recursive: true });
    writeFileSync(join(opencodeDir, "opencode.json"), `${JSON.stringify({ plugin: [] }, null, 2)}\n`, "utf-8");
    writeFileSync(geminiSettingsPath, "{ not-json", "utf-8");

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: homeDir,
    };

    const { code, stderr } = await captureWrites(() => runInstall(["--no-tui", "--gemini=yes", "--claude=no", "--chatgpt=no"]));

    expect(code).toBe(0);
    expect(stderr).toContain("could not update Gemini plan mode settings");
    expect(stderr).toContain("Manually set experimental.plan=true");
    expect(readFileSync(geminiSettingsPath, "utf-8")).toBe("{ not-json");
  });

  it("keeps legacy gemini_cli detection in update flow while reporting model_cli", async () => {
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

    const { code, stdout, stderr } = await captureWrites(() => runInstall(["--no-tui", "--chatgpt=no"]));

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("oh-my-Aegis update start.");
    expect(stdout).toContain("- Gemini CLI integration: enabled");

    const providerCatalogLine = stdout
      .split("\n")
      .find((line) => line.startsWith("- ensured provider catalogs:"));
    expect(providerCatalogLine).toBe("- ensured provider catalogs: model_cli");
  });

  it("fails with exit code 1 when --bootstrap=yes is blocked by --no-tui", async () => {
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

    const { code, stderr } = await captureWrites(() => runInstall(["--no-tui", "--bootstrap=yes"]));

    expect(code).toBe(1);
    expect(stderr).toContain("Bootstrap requires interactive TTY");
  });

  it("runs npm-first bootstrap and login launches in interactive mode", async () => {
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

    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });

    const commands: string[] = [];
    let geminiInstalled = false;
    let claudeInstalled = false;

    __setInstallCliRuntimeForTests({
      commandExists: async (command) => {
        if (command === "npm") return true;
        if (command === "gemini") return geminiInstalled;
        if (command === "claude") return claudeInstalled;
        return false;
      },
      runInteractive: async (command, args) => {
        commands.push([command, ...args].join(" "));
        if (command === "npm" && args.join(" ") === "install -g @google/gemini-cli") {
          geminiInstalled = true;
        }
        if (command === "npm" && args.join(" ") === "install -g @anthropic-ai/claude-code") {
          claudeInstalled = true;
        }
        return {
          ok: true,
          exitCode: 0,
          errorMessage: null,
        };
      },
    });

    const { code, stderr } = await captureWrites(() =>
      runInstall(["--chatgpt=no", "--gemini=yes", "--claude=yes", "--bootstrap=yes"])
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(commands).toEqual([
      "npm install -g @google/gemini-cli",
      "gemini",
      "npm install -g @anthropic-ai/claude-code",
      "claude",
    ]);
  });
});
