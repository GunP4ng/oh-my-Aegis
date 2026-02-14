import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyAegisConfig } from "../src/install/apply-config";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function makeRoot(): string {
  const root = join(tmpdir(), `aegis-install-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  return root;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

describe("install apply config", () => {
  it("registers package plugin entry and bootstraps required mappings", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const env = {
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    } as NodeJS.ProcessEnv;

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: env,
    });

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];
    const agent = typeof opencode.agent === "object" && opencode.agent ? opencode.agent : {};
    const mcp = typeof opencode.mcp === "object" && opencode.mcp ? opencode.mcp : {};

    expect(plugin).toContain("oh-my-aegis");
    expect(Object.prototype.hasOwnProperty.call(agent, "ctf-web3")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(agent, "ctf-verify")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(mcp, "context7")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(mcp, "grep_app")).toBe(true);

    const aegis = readJson(result.aegisPath);
    expect(aegis.default_mode).toBe("BOUNTY");
    expect((aegis.auto_dispatch as Record<string, unknown>).operational_feedback_enabled).toBe(false);
    expect(result.backupPath).toBeNull();
  });

  it("creates backup when opencode.json already exists", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify({ plugin: ["existing-plugin"] }, null, 2)}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: true,
    });

    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath as string)).toBe(true);

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];
    expect(plugin).toContain("existing-plugin");
    expect(plugin).toContain("oh-my-aegis");
  });
});
