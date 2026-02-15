import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import OhMyAegisPlugin from "../src/index";

const roots: string[] = [];
const originalHome = process.env.HOME;
const originalXdg = process.env.XDG_CONFIG_HOME;

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdg;
  }
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function setup(
  opts?: {
    aegisConfig?: Record<string, unknown>;
    opencodeConfig?: Record<string, unknown>;
  }
) {
  const root = join(tmpdir(), `aegis-google-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);

  const homeDir = join(root, "home");
  const projectDir = join(root, "project");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  process.env.HOME = homeDir;
  delete process.env.XDG_CONFIG_HOME;

  const opencodeDir = join(homeDir, ".config", "opencode");
  mkdirSync(opencodeDir, { recursive: true });

  const baseAegisConfig = {
    enabled: true,
    default_mode: "BOUNTY",
    enforce_mode_header: false,
  };

  writeFileSync(
    join(opencodeDir, "oh-my-Aegis.json"),
    `${JSON.stringify({ ...baseAegisConfig, ...(opts?.aegisConfig ?? {}) }, null, 2)}\n`,
    "utf-8"
  );

  if (opts?.opencodeConfig) {
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify(opts.opencodeConfig, null, 2)}\n`,
      "utf-8"
    );
  }

  return { projectDir };
}

describe("google antigravity oauth hook", () => {
  it("auto-disables built-in google auth when opencode-antigravity-auth plugin is installed", async () => {
    const { projectDir } = setup({
      // google_auth omitted => auto
      opencodeConfig: {
        plugin: ["opencode-antigravity-auth@latest"],
        agent: {},
      },
    });

    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    expect((hooks as Record<string, unknown>).auth).toBeUndefined();
  });

  it("force-enables built-in google auth when google_auth=true", async () => {
    const { projectDir } = setup({
      aegisConfig: {
        google_auth: true,
      },
      opencodeConfig: {
        plugin: ["opencode-antigravity-auth@latest"],
        agent: {},
      },
    });

    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const auth = (hooks as Record<string, unknown>).auth as Record<string, unknown> | undefined;
    expect(auth).toBeDefined();
    expect(auth?.provider).toBe("google");
    expect(Array.isArray(auth?.methods)).toBe(true);
  });

  it("disables built-in google auth when google_auth=false", async () => {
    const { projectDir } = setup({
      aegisConfig: {
        google_auth: false,
      },
      opencodeConfig: {
        plugin: [],
        agent: {},
      },
    });

    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    expect((hooks as Record<string, unknown>).auth).toBeUndefined();
  });
});
