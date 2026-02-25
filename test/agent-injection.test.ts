import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import OhMyAegisPlugin from "../src/index";

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
  const root = join(tmpdir(), `aegis-agent-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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
    enable_builtin_mcps: false,
  };

  writeFileSync(
    join(opencodeDir, "oh-my-Aegis.json"),
    `${JSON.stringify({ ...base, ...(overrides ?? {}) }, null, 2)}\n`,
    "utf-8"
  );

  return { projectDir };
}

describe("Aegis orchestrator agent injection", () => {
  it("injects 'Aegis' agent into runtime config", async () => {
    const { projectDir } = setupConfig();
    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const runtimeConfig: Record<string, unknown> = { agent: {}, model: "openai/gpt-5.3-codex" };
    await hooks.config?.(runtimeConfig as never);

    const agents = runtimeConfig.agent as Record<string, unknown>;
    expect(agents.Aegis).toBeDefined();
    const aegis = agents.Aegis as Record<string, unknown>;
    expect(aegis.mode).toBe("primary");
    expect(aegis.hidden).not.toBe(true);
    expect(typeof aegis.prompt).toBe("string");
    expect((aegis.prompt as string).includes("CTF/BOUNTY orchestrator")).toBe(true);
    const permission = aegis.permission as Record<string, unknown>;
    expect(permission.edit).toBe("deny");
    expect(permission.bash).toBe("deny");
    expect(permission.webfetch).toBe("deny");

    // Should not change default_agent automatically
    expect((runtimeConfig as { default_agent?: unknown }).default_agent).toBeUndefined();
  });

  it("injects internal subagents as hidden subagents", async () => {
    const { projectDir } = setupConfig();
    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const runtimeConfig: Record<string, unknown> = { agent: {}, model: "openai/gpt-5.3-codex" };
    await hooks.config?.(runtimeConfig as never);

    const agents = runtimeConfig.agent as Record<string, unknown>;
    const subagentNames = ["aegis-plan", "aegis-exec", "aegis-deep", "aegis-explore", "aegis-librarian"];
    for (const name of subagentNames) {
      const agent = agents[name] as Record<string, unknown>;
      expect(agent).toBeDefined();
      expect(agent.mode).toBe("subagent");
      expect(agent.hidden).toBe(true);
    }

    const explorePermission = (agents["aegis-explore"] as { permission?: Record<string, unknown> }).permission ?? {};
    expect(explorePermission.edit).toBe("deny");
    expect(explorePermission.bash).toBe("deny");
    expect(explorePermission.webfetch).toBe("deny");

    const librarianPermission = (agents["aegis-librarian"] as { permission?: Record<string, unknown> }).permission ?? {};
    expect(librarianPermission.edit).toBe("deny");
    expect(librarianPermission.bash).toBe("deny");
    expect(librarianPermission.webfetch).toBe("allow");
  });

  it("keeps existing 'Aegis' fields while enforcing manager permissions", async () => {
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
      agent: { Aegis: { description: "custom" } },
      model: "openai/gpt-5.3-codex",
    };

    await hooks.config?.(runtimeConfig as never);
    const agents = runtimeConfig.agent as Record<string, unknown>;
    const aegis = agents.Aegis as Record<string, unknown>;
    expect(aegis.description).toBe("custom");
    expect(aegis.mode).toBe("primary");
    expect(aegis.hidden).not.toBe(true);
    const permission = aegis.permission as Record<string, unknown>;
    expect(permission.edit).toBe("deny");
    expect(permission.bash).toBe("deny");
    expect(permission.webfetch).toBe("deny");
  });

  it("keeps preconfigured internal subagent fields while forcing hidden subagent mode", async () => {
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
      agent: {
        "aegis-plan": {
          description: "custom planner",
          prompt: "keep this",
          mode: "primary",
          hidden: false,
        },
      },
      model: "openai/gpt-5.3-codex",
    };

    await hooks.config?.(runtimeConfig as never);
    const agents = runtimeConfig.agent as Record<string, unknown>;
    const aegisPlan = agents["aegis-plan"] as Record<string, unknown>;
    expect(aegisPlan.description).toBe("custom planner");
    expect(aegisPlan.prompt).toBe("keep this");
    expect(aegisPlan.mode).toBe("subagent");
    expect(aegisPlan.hidden).toBe(true);
  });
});
