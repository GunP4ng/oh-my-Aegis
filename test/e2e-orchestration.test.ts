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

function setup() {
  const root = join(tmpdir(), `aegis-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);

  const homeDir = join(root, "home");
  const projectDir = join(root, "project");
  const opencodeDir = join(homeDir, ".config", "opencode");
  mkdirSync(opencodeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  process.env.HOME = homeDir;

  writeFileSync(
    join(opencodeDir, "oh-my-Aegis.json"),
    `${JSON.stringify(
      {
        enabled: true,
        enforce_mode_header: false,
        strict_readiness: false,
        auto_dispatch: {
          enabled: true,
          preserve_user_category: true,
          max_failover_retries: 2,
        },
        parallel: {
          auto_dispatch_scan: true,
          auto_dispatch_hypothesis: true,
        },
      },
      null,
      2
    )}\n`,
    "utf-8"
  );

  writeFileSync(
    join(opencodeDir, "opencode.json"),
    `${JSON.stringify(
      {
        agent: {
          "ctf-web3": {},
          "ctf-research": {},
          "ctf-hypothesis": {},
          "ctf-verify": {},
          "ctf-decoy-check": {},
        },
        mcp: {
          context7: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true },
          grep_app: { type: "remote", url: "https://mcp.grep.app", enabled: true },
        },
      },
      null,
      2
    )}\n`,
    "utf-8"
  );

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

describe("e2e orchestration flow", () => {
  it("routes WEB3, applies playbook, and handles retryable task failover", async () => {
    const { projectDir } = setup();
    const hooks = await loadHooks(projectDir);

    await hooks.tool?.ctf_orch_set_mode.execute({ mode: "CTF" }, { sessionID: "s1" } as never);
    await hooks["chat.message"]?.(
      { sessionID: "s1" },
      {
        message: { role: "assistant" } as never,
        parts: [{ type: "text", text: "target is a web3 smart contract with solidity" } as never],
      }
    );


    const beforeOutput = {
      args: {
        prompt: "start analysis",
      },
    };

    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "s1", callID: "c1", args: {} },
      beforeOutput
    );

    const args1 = beforeOutput.args as Record<string, unknown>;
    expect(args1.subagent_type).toBe("aegis-deep");
    expect((args1.prompt as string).includes("[oh-my-Aegis domain-playbook]")).toBe(true);
    expect((args1.prompt as string).includes("[oh-my-Aegis auto-parallel]")).toBe(true);
    expect((args1.prompt as string).includes("target=WEB3")).toBe(true);

    await hooks["tool.execute.after"]?.(
      { tool: "task", sessionID: "s1", callID: "c2", args: {} },
      { title: "task failed", output: "status 429 rate_limit_exceeded", metadata: {} }
    );

    const failoverOutput = {
      args: {
        prompt: "retry analysis",
      },
    };

    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "s1", callID: "c3", args: {} },
      failoverOutput
    );

    const args2 = failoverOutput.args as Record<string, unknown>;
    expect(args2.subagent_type).toBe("ctf-research");

    await hooks["tool.execute.after"]?.(
      { tool: "task", sessionID: "s1", callID: "c4", args: {} },
      { title: "task completed", output: "done", metadata: {} }
    );

    const recoveredOutput = {
      args: {
        prompt: "continue scan",
      },
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "s1", callID: "c5", args: {} },
      recoveredOutput
    );

    const args3 = recoveredOutput.args as Record<string, unknown>;
    expect(args3.subagent_type).toBe("aegis-deep");
  });
});
