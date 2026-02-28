import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import OhMyAegisPlugin from "../src/index";
import { buildToolGuide } from "../src/orchestration/tool-guide";
import { SessionStore } from "../src/state/session-store";

const roots: string[] = [];
const originalHome = process.env.HOME;

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
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function setupEnvironment() {
  const root = join(tmpdir(), `aegis-tool-guide-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);

  const homeDir = join(root, "home");
  const projectDir = join(root, "project");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  process.env.HOME = homeDir;
  const opencodeDir = join(homeDir, ".config", "opencode");
  mkdirSync(opencodeDir, { recursive: true });

  writeFileSync(
    join(opencodeDir, "oh-my-Aegis.json"),
    `${JSON.stringify(
      {
        enabled: true,
        default_mode: "BOUNTY",
        enforce_mode_header: false,
        notes: { root_dir: ".Aegis" },
      },
      null,
      2
    )}\n`,
    "utf-8"
  );

  const agentConfig: Record<string, Record<string, never>> = {};
  for (const name of REQUIRED_SUBAGENTS) {
    agentConfig[name] = {};
  }

  writeFileSync(
    join(opencodeDir, "opencode.json"),
    `${JSON.stringify({ agent: agentConfig }, null, 2)}\n`,
    "utf-8"
  );

  return { projectDir };
}

async function loadHooks(projectDir: string, client: unknown = {}): Promise<any> {
  return OhMyAegisPlugin({
    client: client as never,
    project: {} as never,
    directory: projectDir,
    worktree: projectDir,
    serverUrl: new URL("http://localhost"),
    $: {} as never,
  });
}

function extractToolIds(guide: string): Set<string> {
  const ids = new Set<string>();
  for (const rawLine of guide.split("\n")) {
    if (!rawLine.includes("—") && !/\s-\s/.test(rawLine)) {
      continue;
    }
    const firstToken = rawLine.trim().split(/\s+/)[0] ?? "";
    if (firstToken) {
      ids.add(firstToken);
    }
  }
  return ids;
}

describe("tool guide registry sync", () => {
  it("ensures every buildToolGuide tool id is registered in runtime hooks", async () => {
    const { projectDir } = setupEnvironment();
    const hooks = await loadHooks(projectDir);
    const store = new SessionStore(projectDir);

    store.setMode("scan", "CTF");
    const scanState = store.get("scan");

    store.setMode("plan", "CTF");
    store.applyEvent("plan", "scan_completed");
    const planState = store.get("plan");

    store.setMode("exec-rev", "CTF");
    store.applyEvent("exec-rev", "scan_completed");
    store.applyEvent("exec-rev", "plan_completed");
    store.setTargetType("exec-rev", "REV");
    const executeRevState = store.get("exec-rev");

    store.setMode("exec-pwn", "CTF");
    store.applyEvent("exec-pwn", "scan_completed");
    store.applyEvent("exec-pwn", "plan_completed");
    store.setTargetType("exec-pwn", "PWN");
    const executePwnState = store.get("exec-pwn");

    store.setMode("verify", "CTF");
    store.applyEvent("verify", "scan_completed");
    store.applyEvent("verify", "plan_completed");
    store.applyEvent("verify", "candidate_found");
    const verifyState = store.get("verify");

    const allToolIds = new Set<string>();
    for (const state of [scanState, planState, executeRevState, executePwnState, verifyState]) {
      for (const toolId of extractToolIds(buildToolGuide(state))) {
        allToolIds.add(toolId);
      }
    }

    expect(allToolIds.size).toBeGreaterThan(0);
    const missing = Array.from(allToolIds).filter((toolId) => typeof hooks.tool?.[toolId]?.execute !== "function");
    expect(missing).toEqual([]);
  });
});
