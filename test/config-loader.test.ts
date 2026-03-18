import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config/loader";

const roots: string[] = [];
const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

describe("config loader", () => {
  it("falls back to defaults when user config shape is invalid", () => {
    const root = join(tmpdir(), `aegis-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    roots.push(root);
    const homeDir = join(root, "home");
    const projectDir = join(root, "project");
    const opencodeDir = join(homeDir, ".config", "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    process.env.HOME = homeDir;

    writeFileSync(
      join(opencodeDir, "oh-my-Aegis.json"),
      `${JSON.stringify({ auto_dispatch: { max_failover_retries: -1 } }, null, 2)}\n`,
      "utf-8"
    );

    const config = loadConfig(projectDir);
    expect(config.auto_dispatch.max_failover_retries).toBe(2);
    expect(config.default_mode).toBe("BOUNTY");
  });

  it("materializes governance schema defaults with fail-closed settings", () => {
    const root = join(tmpdir(), `aegis-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    roots.push(root);
    const homeDir = join(root, "home");
    const projectDir = join(root, "project");
    const opencodeDir = join(homeDir, ".config", "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    process.env.HOME = homeDir;

    const config = loadConfig(projectDir);
    expect(config.patch_boundary.enabled).toBe(true);
    expect(config.patch_boundary.fail_closed).toBe(true);
    expect(config.review_gate.enabled).toBe(true);
    expect(config.review_gate.fail_closed).toBe(true);
    expect(config.council.enabled).toBe(true);
    expect(config.council.fail_closed).toBe(true);
    expect(config.apply_lock.enabled).toBe(true);
    expect(config.apply_lock.fail_closed).toBe(true);
  });

  it("falls back to safe governance schema defaults on invalid thresholds", () => {
    const root = join(tmpdir(), `aegis-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    roots.push(root);
    const homeDir = join(root, "home");
    const projectDir = join(root, "project");
    const opencodeDir = join(homeDir, ".config", "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    process.env.HOME = homeDir;

    writeFileSync(
      join(opencodeDir, "oh-my-Aegis.json"),
      `${JSON.stringify({ council: { thresholds: { max_loc: 0 } } }, null, 2)}\n`,
      "utf-8"
    );

    const config = loadConfig(projectDir);
    expect(config.council.fail_closed).toBe(true);
    expect(config.council.thresholds.max_loc).toBe(500);
  });

  it("deep merges nested objects across user and project config", () => {
    const root = join(tmpdir(), `aegis-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    roots.push(root);
    const homeDir = join(root, "home");
    const projectDir = join(root, "project");
    const opencodeDir = join(homeDir, ".config", "opencode");
    const projectCfgDir = join(projectDir, ".Aegis");
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(projectCfgDir, { recursive: true });
    process.env.HOME = homeDir;

    writeFileSync(
      join(opencodeDir, "oh-my-Aegis.json"),
      `${JSON.stringify({ tool_output_truncator: { per_tool_max_chars: { grep: 1111 } } }, null, 2)}\n`,
      "utf-8",
    );

    writeFileSync(
      join(projectCfgDir, "oh-my-Aegis.json"),
      `${JSON.stringify({ tool_output_truncator: { max_chars: 12345 } }, null, 2)}\n`,
      "utf-8",
    );

    const config = loadConfig(projectDir);
    expect(config.tool_output_truncator.max_chars).toBe(12345);
    expect(config.tool_output_truncator.per_tool_max_chars.grep).toBe(1111);
  });

  it("does not allow project config to enable claude hooks", () => {
    const root = join(tmpdir(), `aegis-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    roots.push(root);
    const homeDir = join(root, "home");
    const projectDir = join(root, "project");
    const opencodeDir = join(homeDir, ".config", "opencode");
    const projectCfgDir = join(projectDir, ".Aegis");
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(projectCfgDir, { recursive: true });
    process.env.HOME = homeDir;

    writeFileSync(
      join(projectCfgDir, "oh-my-Aegis.json"),
      `${JSON.stringify({ claude_hooks: { enabled: true } }, null, 2)}\n`,
      "utf-8",
    );

    const config = loadConfig(projectDir);
    expect(config.claude_hooks.enabled).toBe(false);
  });

  it("allows user config to enable claude hooks", () => {
    const root = join(tmpdir(), `aegis-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    roots.push(root);
    const homeDir = join(root, "home");
    const projectDir = join(root, "project");
    const opencodeDir = join(homeDir, ".config", "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    process.env.HOME = homeDir;

    writeFileSync(
      join(opencodeDir, "oh-my-Aegis.json"),
      `${JSON.stringify({ claude_hooks: { enabled: true, max_runtime_ms: 2000 } }, null, 2)}\n`,
      "utf-8"
    );

    const config = loadConfig(projectDir);
    expect(config.claude_hooks.enabled).toBe(true);
    expect(config.claude_hooks.max_runtime_ms).toBe(2000);
  });

  it("emits warnings when config JSON is invalid", () => {
    const root = join(tmpdir(), `aegis-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    roots.push(root);
    const homeDir = join(root, "home");
    const projectDir = join(root, "project");
    const opencodeDir = join(homeDir, ".config", "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    process.env.HOME = homeDir;

    writeFileSync(join(opencodeDir, "oh-my-Aegis.json"), "{\n", "utf-8");

    const warnings: string[] = [];
    const config = loadConfig(projectDir, {
      onWarning: (msg) => warnings.push(msg),
    });

    expect(config.default_mode).toBe("BOUNTY");
    expect(warnings.some((w) => w.includes("Failed to parse config JSON"))).toBe(true);
  });
});
