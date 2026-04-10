import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import OhMyAegisPlugin from "../src/index";
import {
  getToolAccessProfile,
  isAegisManagerAllowedTool,
  isAegisPlanningAllowedTool,
} from "../src/helpers/plugin-utils";
import { createClaudeSafeBashTool } from "../src/tools/claude-safe-bash-tool";
import { createClaudeSafeGlobTool } from "../src/tools/claude-safe-glob-tool";
import { createClaudeSafeReadTool } from "../src/tools/claude-safe-read-tool";
import { createClaudeSafeWebfetchTool } from "../src/tools/claude-safe-webfetch-tool";

const roots: string[] = [];
const originalHome = process.env.HOME;
const originalFetch = globalThis.fetch;

const REQUIRED_SUBAGENTS = [
  "aegis-plan",
  "aegis-exec",
  "aegis-deep",
  "bounty-scope",
  "ctf-web",
  "ctf-web3",
  "ctf-pwn",
  "ctf-rev",
  "ctf-crypto",
  "ctf-forensics",
  "ctf-explore",
  "ctf-solve",
  "ctf-research",
  "ctf-hypothesis",
  "ctf-decoy-check",
  "ctf-verify",
  "bounty-triage",
  "bounty-research",
  "deep-plan",
  "md-scribe",
  "explore-fallback",
  "librarian-fallback",
  "oracle-fallback",
];

afterEach(() => {
  process.env.HOME = originalHome;
  globalThis.fetch = originalFetch;
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function setupEnvironment(): { projectDir: string } {
  const root = join(tmpdir(), `aegis-manager-safe-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);

  const homeDir = join(root, "home");
  const projectDir = join(root, "project");
  const opencodeDir = join(homeDir, ".config", "opencode");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(opencodeDir, { recursive: true });
  process.env.HOME = homeDir;

  writeFileSync(join(opencodeDir, "oh-my-Aegis.json"), `${JSON.stringify({ claude_hooks: { enabled: false } }, null, 2)}\n`, "utf-8");

  const agentConfig: Record<string, Record<string, never>> = {};
  for (const name of REQUIRED_SUBAGENTS) {
    agentConfig[name] = {};
  }
  writeFileSync(join(opencodeDir, "opencode.json"), `${JSON.stringify({ agent: agentConfig }, null, 2)}\n`, "utf-8");

  return { projectDir };
}

async function loadHooks(projectDir: string): Promise<any> {
  return OhMyAegisPlugin({
    client: {} as never,
    project: {} as never,
    directory: projectDir,
    worktree: projectDir,
    serverUrl: new URL("http://localhost"),
    $: {} as never,
  });
}

describe("manager-safe wrapper tools", () => {
  it("allows aegis wrapper discovery tools for the Aegis manager while keeping aegis_bash blocked", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await hooks.tool?.ctf_orch_set_mode.execute({ mode: "CTF" }, { sessionID: "s_wrappers" } as never);

    const skillOutput = { args: { skill_name: "demo-skill" } };
    await expect(
      hooks["tool.execute.before"]?.(
        {
          tool: "aegis_skill",
          sessionID: "s_wrappers",
          callID: "c_wrapper_skill",
          args: {},
          agent: "Aegis",
        } as never,
        skillOutput as never
      )
    ).resolves.toBeUndefined();

    const readOutput = { args: { target_path: join(projectDir, "README.md") } };
    await expect(
      hooks["tool.execute.before"]?.(
        {
          tool: "aegis_read",
          sessionID: "s_wrappers",
          callID: "c_wrapper_read",
          args: {},
          agent: "Aegis",
        } as never,
        readOutput as never
      )
    ).resolves.toBeUndefined();

    const webfetchOutput = { args: { target_url: "https://example.com" } };
    await expect(
      hooks["tool.execute.before"]?.(
        {
          tool: "aegis_webfetch",
          sessionID: "s_wrappers",
          callID: "c_wrapper_webfetch",
          args: {},
          agent: "Aegis",
        } as never,
        webfetchOutput as never
      )
    ).resolves.toBeUndefined();

    const bashOutput = { args: { command: "printf 'wrapper-ok'" } };
    await expect(
      hooks["tool.execute.before"]?.(
        {
          tool: "aegis_bash",
          sessionID: "s_wrappers",
          callID: "c_wrapper_bash",
          args: {},
          agent: "Aegis",
        } as never,
        bashOutput as never
      )
    ).rejects.toThrow("Aegis manager cannot execute 'aegis_bash' directly");

    const globOutput = { args: { pattern: "**/*.md", path: projectDir } };
    await expect(
      hooks["tool.execute.before"]?.(
        {
          tool: "aegis_glob",
          sessionID: "s_wrappers",
          callID: "c_wrapper_glob",
          args: {},
          agent: "Aegis",
        } as never,
        globOutput as never
      )
    ).resolves.toBeUndefined();

    expect(skillOutput.args).toEqual({ skill_name: "demo-skill" });
    expect(readOutput.args).toMatchObject({ target_path: join(projectDir, "README.md") });
    expect(webfetchOutput.args).toEqual({ target_url: "https://example.com" });
    expect(bashOutput.args).toEqual({ command: "printf 'wrapper-ok'" });
    expect(globOutput.args).toEqual({ pattern: "**/*.md", path: projectDir });
  });

  it("sets metadata titles for bash, glob, read, and webfetch wrappers", async () => {
    const { projectDir } = setupEnvironment();
    writeFileSync(join(projectDir, "README.md"), "hello\n", "utf-8");
    globalThis.fetch = (async () => new Response("WEBFETCH_OK", { status: 200 })) as unknown as typeof fetch;

    const bashTool = createClaudeSafeBashTool(projectDir);
    const globTool = createClaudeSafeGlobTool(projectDir);
    const readTool = createClaudeSafeReadTool(projectDir);
    const webfetchTool = createClaudeSafeWebfetchTool();
    const titles: string[] = [];
    const metadataContext = { metadata: (input: { title?: string }) => titles.push(input.title ?? "") };

    const bashResult = await (bashTool.execute as unknown as (args: unknown, ctx: typeof metadataContext) => Promise<string>)(
      { command: "printf 'BASH_OK'" },
      metadataContext
    );
    const globResult = await (globTool.execute as unknown as (args: unknown, ctx: typeof metadataContext) => Promise<string>)(
      { pattern: "**/*.md", path: projectDir },
      metadataContext
    );
    await (readTool.execute as unknown as (args: unknown, ctx: typeof metadataContext) => Promise<string>)(
      { target_path: join(projectDir, "README.md") },
      metadataContext
    );
    await (webfetchTool.execute as unknown as (args: unknown, ctx: typeof metadataContext) => Promise<string>)(
      { target_url: "https://example.com" },
      metadataContext
    );

    expect(bashResult).toBe("BASH_OK");
    expect(globResult).toContain("README.md");
    expect(titles).toEqual(["aegis_bash", "aegis_glob", "aegis_read", "aegis_webfetch"]);
  });

  it("suppresses duplicate wrapper output titles in tool.execute.after", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await hooks.tool?.ctf_orch_set_mode.execute({ mode: "CTF" }, { sessionID: "s_wrapper_titles" } as never);

    const skillAfterOutput = { title: "Unknown", output: "ok", metadata: {} };
    await hooks["tool.execute.after"]?.(
      {
        tool: "aegis_skill",
        sessionID: "s_wrapper_titles",
        callID: "c_after_skill",
        args: {},
        agent: "Aegis",
      } as never,
      skillAfterOutput as never
    );

    const bashAfterOutput = { title: "Unknown", output: "ok", metadata: {} };
    await hooks["tool.execute.after"]?.(
      {
        tool: "aegis_bash",
        sessionID: "s_wrapper_titles",
        callID: "c_after_bash",
        args: {},
        agent: "Aegis",
      } as never,
      bashAfterOutput as never
    );

    const globAfterOutput = { title: "Unknown", output: "ok", metadata: {} };
    await hooks["tool.execute.after"]?.(
      {
        tool: "aegis_glob",
        sessionID: "s_wrapper_titles",
        callID: "c_after_glob",
        args: {},
        agent: "Aegis",
      } as never,
      globAfterOutput as never
    );

    const readAfterOutput = { title: "Unknown", output: "ok", metadata: {} };
    await hooks["tool.execute.after"]?.(
      {
        tool: "aegis_read",
        sessionID: "s_wrapper_titles",
        callID: "c_after_read",
        args: {},
        agent: "Aegis",
      } as never,
      readAfterOutput as never
    );

    const webfetchAfterOutput = { title: "Unknown", output: "ok", metadata: {} };
    await hooks["tool.execute.after"]?.(
      {
        tool: "aegis_webfetch",
        sessionID: "s_wrapper_titles",
        callID: "c_after_webfetch",
        args: {},
        agent: "Aegis",
      } as never,
      webfetchAfterOutput as never
    );

    expect(skillAfterOutput.title).toBe("\u200b");
    expect(bashAfterOutput.title).toBe("\u200b");
    expect(globAfterOutput.title).toBe("\u200b");
    expect(readAfterOutput.title).toBe("\u200b");
    expect(webfetchAfterOutput.title).toBe("\u200b");
  });

  it("allows selected governance/evidence tools for the Aegis manager", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    await hooks.tool?.ctf_orch_set_mode.execute({ mode: "CTF" }, { sessionID: "s_manager_governance" } as never);

    await expect(
      hooks["tool.execute.before"]?.(
        {
          tool: "ctf_patch_audit",
          sessionID: "s_manager_governance",
          callID: "c_manager_patch_audit",
          args: {},
          agent: "Aegis",
        } as never,
        { args: {} } as never
      )
    ).resolves.toBeUndefined();

    await expect(
      hooks["tool.execute.before"]?.(
        {
          tool: "ctf_evidence_ledger",
          sessionID: "s_manager_governance",
          callID: "c_manager_evidence_ledger",
          args: {},
          agent: "Aegis",
        } as never,
        {
          args: {
            event: "manual",
            evidence_type: "static_reverse",
            confidence: 0.8,
            summary: "manager-safe bounded recorder",
            source: "test",
          },
        } as never
      )
    ).resolves.toBeUndefined();
  });

  it("keeps governance transition tools blocked for the Aegis manager", () => {
    expect(isAegisManagerAllowedTool("ctf_patch_apply")).toBe(false);
    expect(isAegisManagerAllowedTool("ctf_patch_review")).toBe(false);
    expect(isAegisManagerAllowedTool("ctf_patch_propose")).toBe(false);
  });

  it("keeps bounded governance recorders unavailable to planning agents", () => {
    expect(isAegisPlanningAllowedTool("ctf_patch_audit")).toBe(true);
    expect(isAegisPlanningAllowedTool("ctf_evidence_ledger")).toBe(false);
  });

  it("classifies aegis_bash as execution and blocks it for manager/planning roles", () => {
    expect(isAegisManagerAllowedTool("aegis_bash")).toBe(false);
    expect(isAegisPlanningAllowedTool("aegis_bash")).toBe(false);
    expect(getToolAccessProfile("aegis_bash")?.capabilities).toEqual(["external_execution"]);
  });

  it("classifies governance manager-safe tools explicitly", () => {
    for (const toolName of [
      "ctf_patch_audit",
      "ctf_evidence_ledger",
      "ctf_patch_propose",
      "ctf_patch_review",
      "ctf_patch_apply",
    ]) {
      expect(getToolAccessProfile(toolName)).not.toBeNull();
    }
  });
});
