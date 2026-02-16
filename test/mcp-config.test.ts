import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import OhMyAegisPlugin from "../src/index";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePathForTest(path: string): string {
  return path.replace(/\\/g, "/");
}

const roots: string[] = [];
const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function setupConfig(overrides?: Record<string, unknown>) {
  const root = join(tmpdir(), `aegis-mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  const homeDir = join(root, "home");
  const projectDir = join(root, "project");
  const opencodeDir = join(homeDir, ".config", "opencode");
  mkdirSync(opencodeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  process.env.HOME = homeDir;

  const base = {
    enabled: true,
    default_mode: "BOUNTY",
    enforce_mode_header: false,
  };

  writeFileSync(
    join(opencodeDir, "oh-my-Aegis.json"),
    `${JSON.stringify({ ...base, ...(overrides ?? {}) }, null, 2)}\n`,
    "utf-8"
  );

  return { projectDir };
}

describe("mcp builtins", () => {
  it("injects default builtin MCPs into runtime config", async () => {
    const { projectDir } = setupConfig();
    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const runtimeConfig: Record<string, unknown> = { mcp: {} };
    await hooks.config?.(runtimeConfig as never);
    const mcp = runtimeConfig.mcp as Record<string, unknown>;
    expect(mcp.context7).toBeDefined();
    expect(mcp.grep_app).toBeDefined();
  });

  it("injects memory MCP with absolute project-local MEMORY_FILE_PATH", async () => {
    const { projectDir } = setupConfig();
    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const runtimeConfig: Record<string, unknown> = { mcp: {} };
    await hooks.config?.(runtimeConfig as never);
    const mcp = runtimeConfig.mcp as unknown;
    expect(isRecord(mcp)).toBe(true);
    const memory = (mcp as Record<string, unknown>).memory;
    expect(isRecord(memory)).toBe(true);
    expect((memory as Record<string, unknown>).type).toBe("local");
    const env = isRecord((memory as Record<string, unknown>).environment)
      ? ((memory as Record<string, unknown>).environment as Record<string, unknown>)
      : null;
    const filePath = env && typeof env.MEMORY_FILE_PATH === "string" ? env.MEMORY_FILE_PATH : "";
    expect(typeof filePath).toBe("string");
    expect(isAbsolute(filePath)).toBe(true);
    const rel = normalizePathForTest(relative(projectDir, filePath));
    expect(rel).toBe(".Aegis/memory/memory.jsonl");
  });

  it("overrides memory MCP if existing MEMORY_FILE_PATH is outside project", async () => {
    const { projectDir } = setupConfig();
    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const runtimeConfig: Record<string, unknown> = {
      mcp: {
        memory: {
          type: "local",
          command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
          environment: { MEMORY_FILE_PATH: "/tmp/global-memory.jsonl" },
          enabled: true,
        },
      },
    };

    await hooks.config?.(runtimeConfig as never);
    const mcp = runtimeConfig.mcp as unknown;
    expect(isRecord(mcp)).toBe(true);
    const memory = (mcp as Record<string, unknown>).memory;
    expect(isRecord(memory)).toBe(true);
    const env = isRecord((memory as Record<string, unknown>).environment)
      ? ((memory as Record<string, unknown>).environment as Record<string, unknown>)
      : null;
    const filePath = env && typeof env.MEMORY_FILE_PATH === "string" ? env.MEMORY_FILE_PATH : "";
    expect(isAbsolute(filePath)).toBe(true);
    const rel = normalizePathForTest(relative(projectDir, filePath));
    expect(rel.startsWith(".Aegis/")).toBe(true);
    expect(rel.endsWith("memory.jsonl")).toBe(true);
  });

  it("respects disabled_mcps from Aegis config", async () => {
    const { projectDir } = setupConfig({ disabled_mcps: ["grep_app"] });
    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const runtimeConfig: Record<string, unknown> = { mcp: {} };
    await hooks.config?.(runtimeConfig as never);
    const mcp = runtimeConfig.mcp as Record<string, unknown>;
    expect(mcp.context7).toBeDefined();
    expect(mcp.grep_app).toBeUndefined();
  });
});
