import { describe, expect, it } from "bun:test";
import { spawn as spawnNode } from "node:child_process";
import { resolve } from "node:path";

import { runClaudeCodeCli } from "../src/orchestration/claude-code-cli";

type SpawnFixture = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  mode?: "normal" | "hang";
};

function makeSpawnImpl(params: {
  help: SpawnFixture;
  run: SpawnFixture;
  probe?: SpawnFixture;
  authStatus?: SpawnFixture;
  helpThrowsEnoent?: boolean;
  onCall?: (info: { cmd: string; args: string[]; cwd?: string }) => void;
}): any {
  return (cmd: string, args: string[], options?: { cwd?: string }) => {
    params.onCall?.({ cmd, args, cwd: options?.cwd });

    const isHelp = args.includes("--help");
    const isAuthProbe = args.includes("Reply with exactly AUTH_PROBE_OK.");
    const isAuthStatus = args[0] === "auth" && args[1] === "status";
    if (isHelp && params.helpThrowsEnoent) {
      const err = new Error("spawn ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }

    const fixture = isHelp
      ? params.help
      : isAuthProbe
        ? (params.probe ?? params.run)
        : isAuthStatus
          ? (params.authStatus ?? params.run)
          : params.run;
    const mode = fixture.mode ?? "normal";

    const script =
      mode === "hang"
        ? "setInterval(() => {}, 1000);"
        : [
            `process.stdout.write(${JSON.stringify(fixture.stdout ?? "")});`,
            `process.stderr.write(${JSON.stringify(fixture.stderr ?? "")});`,
            `process.exit(${fixture.exitCode ?? 0});`,
          ].join("\n");

    return spawnNode(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  };
}

const SAFE_HELP_TEXT = [
  "-p, --print",
  "--output-format text",
  "--permission-mode <mode> (plan, auto, bypass)",
  "--tools <list>",
  "--no-session-persistence",
  "--effort <level>",
  "--max-turns <n>",
  "--model <id>",
].join("\n");

const PROPOSAL_CONTEXT = {
  sandbox_cwd: "/tmp/.Aegis/runs/run-123/sandbox",
  run_id: "run-123",
  manifest_ref: ".Aegis/runs/run-123/run-manifest.json",
  patch_diff_ref: ".Aegis/runs/run-123/patches/patch-123.diff",
};

const RESOLVED_SANDBOX_CWD = resolve(PROPOSAL_CONTEXT.sandbox_cwd);

describe("claude code cli runner", () => {
  it("returns missing prompt error and does not spawn", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const spawnImpl = makeSpawnImpl({
      help: { stdout: SAFE_HELP_TEXT, exitCode: 0 },
      run: { stdout: "unused", exitCode: 0 },
      onCall: (info) => calls.push(info),
    });

    const res = await runClaudeCodeCli({ prompt: "   ", deps: { spawnImpl } });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("prompt is required");
    expect(calls.length).toBe(0);
  });

  it("returns install hint when claude --help is ENOENT", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const spawnImpl = makeSpawnImpl({
      help: { stdout: "", exitCode: 0 },
      run: { stdout: "unused", exitCode: 0 },
      helpThrowsEnoent: true,
      onCall: (info) => calls.push(info),
    });

    const res = await runClaudeCodeCli({ prompt: "hi", proposal_context: PROPOSAL_CONTEXT, deps: { spawnImpl } });

    expect(res.ok).toBe(false);
    expect(res.exit_code).toBe(127);
    expect(String(res.reason || "")).toContain("binary not found");
    expect(calls.length).toBe(1);
    expect(calls[0]?.args).toEqual(["--help"]);
  });

  it("fails closed on capability check and does not run main command", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const spawnImpl = makeSpawnImpl({
      help: {
        stdout: [
          "-p, --print",
          "--output-format text",
          "--permission-mode <mode> (plan, auto)",
          "--no-session-persistence",
          "--max-turns <n>",
        ].join("\n"),
        exitCode: 0,
      },
      run: { stdout: "should-not-run", exitCode: 0 },
      onCall: (info) => calls.push(info),
    });

    const res = await runClaudeCodeCli({ prompt: "hi", proposal_context: PROPOSAL_CONTEXT, deps: { spawnImpl } });

    expect(res.ok).toBe(false);
    expect(String(res.reason || "")).toContain("missing required safe flags");
    expect(String(res.reason || "")).toContain("--tools");
    expect(calls.length).toBe(1);
    expect(calls[0]?.args).toEqual(["--help"]);
  });

  it("returns timeout on main run", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const spawnImpl = makeSpawnImpl({
      help: { stdout: SAFE_HELP_TEXT, exitCode: 0 },
      run: { mode: "hang" },
      onCall: (info) => calls.push(info),
    });

    const res = await runClaudeCodeCli({
      prompt: "hi",
      proposal_context: PROPOSAL_CONTEXT,
      timeoutMs: 120,
      deps: { spawnImpl },
    });

    expect(res.ok).toBe(false);
    expect(res.exit_code).toBe(124);
    expect(String(res.reason || "")).toContain("timed out");
    expect(calls.length).toBe(4);
    expect(calls[0]?.args).toEqual(["--help"]);
    expect(calls[2]?.args).toContain("Reply with exactly AUTH_PROBE_OK.");
    expect(calls[3]?.args).toEqual(["auth", "status"]);
  });

  it("surfaces expired auth instead of generic timeout when auth probe fails", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const spawnImpl = makeSpawnImpl({
      help: { stdout: SAFE_HELP_TEXT, exitCode: 0 },
      run: { mode: "hang" },
      probe: {
        stderr:
          "Failed to authenticate. API Error: 401 {\"type\":\"authentication_error\",\"message\":\"OAuth token has expired. Please obtain a new token or refresh your existing token.\"}",
        exitCode: 1,
      },
      onCall: (info) => calls.push(info),
    });

    const res = await runClaudeCodeCli({
      prompt: "hi",
      proposal_context: PROPOSAL_CONTEXT,
      timeoutMs: 120,
      deps: { spawnImpl },
    });

    expect(res.ok).toBe(false);
    expect(String(res.reason || "")).toContain("authentication failed");
    expect(String(res.reason || "")).toContain("OAuth token has expired");
    expect(calls.length).toBe(3);
    expect(calls[2]?.args).toContain("Reply with exactly AUTH_PROBE_OK.");
  });

  it("surfaces direct auth failures from the main run", async () => {
    const spawnImpl = makeSpawnImpl({
      help: { stdout: SAFE_HELP_TEXT, exitCode: 0 },
      run: {
        stderr:
          "Failed to authenticate. API Error: 401 {\"type\":\"authentication_error\",\"message\":\"OAuth token has expired. Please obtain a new token or refresh your existing token.\"}",
        exitCode: 1,
      },
    });

    const res = await runClaudeCodeCli({
      prompt: "hi",
      proposal_context: PROPOSAL_CONTEXT,
      deps: { spawnImpl },
    });

    expect(res.ok).toBe(false);
    expect(String(res.reason || "")).toContain("authentication failed");
    expect(String(res.reason || "")).toContain("OAuth token has expired");
  });

  it("normalizes provider-prefixed Claude model IDs to CLI aliases", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const spawnImpl = makeSpawnImpl({
      help: { stdout: SAFE_HELP_TEXT, exitCode: 0 },
      run: { stdout: "normalized model ok", exitCode: 0 },
      onCall: (info) => calls.push(info),
    });

    const res = await runClaudeCodeCli({
      prompt: "hi",
      model: "anthropic/claude-opus-4-6",
      proposal_context: PROPOSAL_CONTEXT,
      deps: { spawnImpl },
    });

    expect(res.ok).toBe(true);
    expect(res.response_text).toBe("normalized model ok");
    const mainArgs = calls[1]?.args ?? [];
    expect(mainArgs).toContain("--model");
    expect(mainArgs[mainArgs.indexOf("--model") + 1]).toBe("opus");
  });

  it("includes auth status details when both the main run and auth probe stall", async () => {
    const spawnImpl = makeSpawnImpl({
      help: { stdout: SAFE_HELP_TEXT, exitCode: 0 },
      run: { mode: "hang" },
      probe: { mode: "hang" },
      authStatus: {
        stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" }),
        exitCode: 0,
      },
    });

    const res = await runClaudeCodeCli({
      prompt: "hi",
      proposal_context: PROPOSAL_CONTEXT,
      timeoutMs: 120,
      deps: { spawnImpl },
    });

    expect(res.ok).toBe(false);
    expect(String(res.reason || "")).toContain("timed out");
    expect(String(res.reason || "")).toContain("loggedIn=true");
    expect(String(res.reason || "")).toContain("authMethod=claude.ai");
  });

  it("returns response_text on success and keeps safe flags", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const spawnImpl = makeSpawnImpl({
      help: { stdout: SAFE_HELP_TEXT, exitCode: 0 },
      run: { stdout: "hello from claude", exitCode: 0 },
      onCall: (info) => calls.push(info),
    });

    const res = await runClaudeCodeCli({
      prompt: "hi",
      model: "claude-sonnet-4",
      effort: "high",
      proposal_context: PROPOSAL_CONTEXT,
      deps: { spawnImpl },
    });

    expect(res.ok).toBe(true);
    expect(res.response_text).toBe("hello from claude");
    expect(res.exit_code).toBe(0);
    expect(res.proposal_envelope).toBeDefined();
    expect(res.proposal_envelope?.run_id).toBe(PROPOSAL_CONTEXT.run_id);
    expect(res.proposal_envelope?.manifest_ref).toBe(PROPOSAL_CONTEXT.manifest_ref);
    expect(res.proposal_envelope?.patch_diff_ref).toBe(PROPOSAL_CONTEXT.patch_diff_ref);
    expect(res.proposal_envelope?.sandbox_cwd).toBe(RESOLVED_SANDBOX_CWD);
    expect(calls.length).toBe(2);

    const mainArgs = calls[1]?.args ?? [];
    expect(mainArgs).toContain("-p");
    expect(mainArgs).toContain("--output-format");
    expect(mainArgs).toContain("text");
    expect(mainArgs).toContain("--permission-mode");
    expect(mainArgs).toContain("plan");
    expect(mainArgs).toContain("--tools");
    expect(mainArgs[mainArgs.indexOf("--tools") + 1]).toBe("");
    expect(mainArgs).toContain("--no-session-persistence");
    expect(mainArgs).toContain("--effort");
    expect(mainArgs[mainArgs.indexOf("--effort") + 1]).toBe("high");
    expect(mainArgs[mainArgs.indexOf("-p") + 1]).toContain("PATCH_PROPOSAL_MODE: sandbox-only");
    expect(calls[0]?.cwd).toBe(RESOLVED_SANDBOX_CWD);
    expect(calls[1]?.cwd).toBe(RESOLVED_SANDBOX_CWD);
  });

  it("fails closed on missing required proposal context", async () => {
    const spawnImpl = makeSpawnImpl({
      help: { stdout: SAFE_HELP_TEXT, exitCode: 0 },
      run: { stdout: "unused", exitCode: 0 },
    });

    const res = await runClaudeCodeCli({ prompt: "hi", deps: { spawnImpl } });
    expect(res.ok).toBe(false);
    expect(String(res.reason || "")).toContain("missing required proposal context");
  });

  it("allows missing proposal context when allowMissingProposalContext=true", async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const spawnImpl = makeSpawnImpl({
      help: { stdout: SAFE_HELP_TEXT, exitCode: 0 },
      run: { stdout: "direct mode ok", exitCode: 0 },
      onCall: (info) => calls.push(info),
    });

    const res = await runClaudeCodeCli({
      prompt: "hi",
      allowMissingProposalContext: true,
      cwd: "/tmp",
      deps: { spawnImpl },
    });

    expect(res.ok).toBe(true);
    expect(res.response_text).toBe("direct mode ok");
    expect(res.proposal_envelope).toBeUndefined();
    expect(calls.length).toBe(2);
    expect(calls[0]?.cwd).toBe(resolve("/tmp"));
    expect(calls[1]?.cwd).toBe(resolve("/tmp"));
  });

  it("fails closed on sandbox cwd mismatch", async () => {
    const spawnImpl = makeSpawnImpl({
      help: { stdout: SAFE_HELP_TEXT, exitCode: 0 },
      run: { stdout: "unused", exitCode: 0 },
    });

    const res = await runClaudeCodeCli({
      prompt: "hi",
      proposal_context: {
        ...PROPOSAL_CONTEXT,
        sandbox_cwd: "/tmp/not-a-sandbox",
      },
      deps: { spawnImpl },
    });
    expect(res.ok).toBe(false);
    expect(String(res.reason || "")).toContain("fails closed");
  });
});
