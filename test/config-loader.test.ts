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
});
