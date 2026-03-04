import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import OhMyAegisPlugin from "../src/index";
import { executePatchBoundaryWorker } from "../src/orchestration/patch-boundary";

const PATCH_POLICY = {
  budgets: {
    max_files: 10,
    max_loc: 500,
  },
  allowed_operations: ["add", "modify"],
  allow_paths: [],
  deny_paths: [],
} as const;

const roots: string[] = [];
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function setup(): { projectDir: string } {
  const root = join(tmpdir(), `aegis-gemini-cli-tool-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);

  const homeDir = join(root, "home");
  const projectDir = join(root, "project");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  process.env = { ...originalEnv, HOME: homeDir };
  delete process.env.XDG_CONFIG_HOME;

  const opencodeDir = join(homeDir, ".config", "opencode");
  mkdirSync(opencodeDir, { recursive: true });

  writeFileSync(
    join(opencodeDir, "oh-my-Aegis.json"),
    `${JSON.stringify({ enabled: true, default_mode: "BOUNTY", enforce_mode_header: false }, null, 2)}\n`,
    "utf-8"
  );
  writeFileSync(
    join(opencodeDir, "opencode.json"),
    `${JSON.stringify({ agent: {} }, null, 2)}\n`,
    "utf-8"
  );

  return { projectDir };
}

function createFakeGeminiBin(projectDir: string): string {
  const fakeGeminiBin = join(projectDir, "fake-gemini.js");
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write("gemini cli help\\n--output-format json\\n--approval-mode [plan|auto]\\n--sandbox\\n--prompt\\n--model\\n");
  process.exit(0);
}
if (process.env.AEGIS_FAKE_GEMINI_ERROR === "1") {
  process.stdout.write(JSON.stringify({ error: { message: "boom" } }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({ response: "hello" }));
process.exit(0);
`;
  writeFileSync(fakeGeminiBin, script, "utf-8");
  chmodSync(fakeGeminiBin, 0o755);
  return fakeGeminiBin;
}

function runGit(cwd: string, args: string[]): void {
  const out = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (out.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${out.stderr || out.stdout}`);
  }
}

function initGitRepo(projectDir: string): void {
  runGit(projectDir, ["init"]);
  runGit(projectDir, ["config", "user.email", "aegis-test@example.com"]);
  runGit(projectDir, ["config", "user.name", "Aegis Test"]);
  writeFileSync(join(projectDir, "tracked.txt"), "base\n", "utf-8");
  runGit(projectDir, ["add", "tracked.txt"]);
  runGit(projectDir, ["commit", "-m", "baseline"]);
}

describe("ctf_gemini_cli tool", () => {
  it("is registered and returns structured JSON using fake gemini binary", async () => {
    const { projectDir } = setup();
    const fakeGeminiBin = createFakeGeminiBin(projectDir);
    process.env.AEGIS_GEMINI_CLI_BIN = fakeGeminiBin;

    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const tool = (hooks as any)?.tool?.ctf_gemini_cli;
    expect(typeof tool?.execute).toBe("function");

    const outRaw = await tool.execute({ prompt: "hi" }, { sessionID: "s1" });
    const parsed = JSON.parse(outRaw) as { ok?: boolean; response_text?: string; sessionID?: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.response_text).toBe("hello");
    expect(parsed.sessionID).toBe("s1");
  });

  it("returns structured tool error from fake gemini binary", async () => {
    const { projectDir } = setup();
    const fakeGeminiBin = createFakeGeminiBin(projectDir);
    process.env.AEGIS_GEMINI_CLI_BIN = fakeGeminiBin;
    process.env.AEGIS_FAKE_GEMINI_ERROR = "1";

    const hooks = await OhMyAegisPlugin({
      client: {} as never,
      project: {} as never,
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const tool = (hooks as any)?.tool?.ctf_gemini_cli;
    expect(typeof tool?.execute).toBe("function");

    const outRaw = await tool.execute({ prompt: "hi" }, { sessionID: "s1" });
    const parsed = JSON.parse(outRaw) as { ok?: boolean; reason?: string; sessionID?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("boom");
    expect(parsed.sessionID).toBe("s1");
  });

  it("runs worker in sandbox cwd and writes patch/manifest artifact refs", async () => {
    const { projectDir } = setup();
    initGitRepo(projectDir);

    const out = await executePatchBoundaryWorker({
      repositoryDir: projectDir,
      workerName: "ctf_gemini_cli",
      patchPolicy: PATCH_POLICY,
      worker: async ({ cwd }) => {
        writeFileSync(join(cwd, "tracked.txt"), "sandbox-change\n", "utf-8");
        return { executedCwd: cwd };
      },
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.workerResult.executedCwd).toContain(join(projectDir, ".Aegis", "runs"));
    expect(out.patchDiffRef.startsWith(".Aegis/runs/")).toBe(true);
    expect(out.manifestRef.startsWith(".Aegis/runs/")).toBe(true);
    expect(existsSync(join(projectDir, out.patchDiffRef))).toBe(true);
    expect(existsSync(join(projectDir, out.manifestRef))).toBe(true);

    const manifestText = readFileSync(join(projectDir, out.manifestRef), "utf-8");
    const manifest = JSON.parse(manifestText) as {
      sandbox: { executionCwd?: string; cleanedUp?: boolean };
      artifacts: { patchDiffRef?: string };
    };
    expect(String(manifest.sandbox.executionCwd || "").startsWith("./.Aegis/runs/")).toBe(true);
    expect(manifest.sandbox.cleanedUp).toBe(true);
    expect(manifest.artifacts.patchDiffRef).toBe(out.patchDiffRef);

    expect(readFileSync(join(projectDir, "tracked.txt"), "utf-8")).toBe("base\n");
  });

  it("fails closed when sandbox bootstrap fails and never runs worker in main cwd", async () => {
    const { projectDir } = setup();
    let workerCalled = false;

    const out = await executePatchBoundaryWorker({
      repositoryDir: projectDir,
      runID: "failed-run",
      workerName: "ctf_gemini_cli",
      patchPolicy: PATCH_POLICY,
      worker: async () => {
        workerCalled = true;
        return { ok: true };
      },
    });

    expect(out.ok).toBe(false);
    expect(workerCalled).toBe(false);
    if (out.ok) return;
    expect(out.fallbackDenied).toBe(true);
    expect(out.reason).toContain("sandbox bootstrap failed");
    expect(existsSync(join(projectDir, ".Aegis", "runs", "failed-run", "sandbox"))).toBe(false);
  });

  it("fails closed when sandbox patch policy is missing", async () => {
    const { projectDir } = setup();
    initGitRepo(projectDir);

    const out = await executePatchBoundaryWorker({
      repositoryDir: projectDir,
      runID: "missing-policy-run",
      workerName: "ctf_gemini_cli",
      worker: async ({ cwd }) => {
        writeFileSync(join(cwd, "tracked.txt"), "sandbox-change\n", "utf-8");
        return { executedCwd: cwd };
      },
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toContain("patch_policy_missing");
    expect(out.fallbackDenied).toBe(true);
  });
});
