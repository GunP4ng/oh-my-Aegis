import { afterEach, describe, expect, it } from "bun:test";
import { spawn as spawnNode } from "node:child_process";

import { runGeminiCli } from "../src/orchestration/gemini-cli";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

const PROPOSAL_CONTEXT = {
  sandbox_cwd: "/tmp/.Aegis/runs/run-456/sandbox",
  run_id: "run-456",
  manifest_ref: ".Aegis/runs/run-456/run-manifest.json",
  patch_diff_ref: ".Aegis/runs/run-456/patches/patch-456.diff",
};

function makeSpawnImpl(params: {
  helpText: string;
  helpExitCode?: number;
  runStdout: string;
  runStderr?: string;
  runExitCode?: number;
  onCall?: (info: { cmd: string; args: string[]; cwd?: string }) => void;
}): any {
  return (cmd: string, args: string[], options?: { cwd?: string }) => {
    params.onCall?.({ cmd, args, cwd: options?.cwd });
    const isHelp = args.includes("--help");
    const stdout = isHelp ? params.helpText : params.runStdout;
    const stderr = isHelp ? "" : params.runStderr ?? "";
    const exitCode = isHelp ? params.helpExitCode ?? 0 : params.runExitCode ?? 0;

    const script = [
      `process.stdout.write(${JSON.stringify(stdout)});`,
      stderr ? `process.stderr.write(${JSON.stringify(stderr)});` : "",
      `process.exit(${exitCode});`,
    ]
      .filter(Boolean)
      .join("\n");

    return spawnNode(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  };
}

describe("gemini cli runner", () => {
  it("returns missing prompt error", async () => {
    const spawnImpl = makeSpawnImpl({
      helpText: "--output-format json\n--approval-mode plan\n--sandbox\n--prompt\n",
      runStdout: JSON.stringify({ response: "hello" }),
    });

    const res = await runGeminiCli({ prompt: "   ", deps: { spawnImpl } });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("prompt is required");
  });

  it("fails closed when required flags are missing from help", async () => {
    process.env = { ...originalEnv, GEMINI_API_KEY: "dummy" };

    const spawnImpl = makeSpawnImpl({
      helpText: "gemini help output without required flags\n",
      runStdout: "{}",
    });

    const res = await runGeminiCli({ prompt: "hi", proposal_context: PROPOSAL_CONTEXT, deps: { spawnImpl } });
    expect(res.ok).toBe(false);
    expect(String(res.reason || "")).toContain("missing required safe flags");
  });

  it("parses json output and returns response_text", async () => {
    process.env = { ...originalEnv, GEMINI_API_KEY: "dummy" };

    const helpText = "--output-format json\n--approval-mode [plan|auto]\n--sandbox\n--prompt\n--model\n";
    const runStdout = JSON.stringify({ response: "hello" });

    let observedCwd: string | undefined;
    const spawnImpl = makeSpawnImpl({
      helpText,
      runStdout,
      onCall: (info) => {
        observedCwd = info.cwd;
      },
    });

    const res = await runGeminiCli({
      prompt: "hi",
      model: "gemini-2.5-pro",
      proposal_context: PROPOSAL_CONTEXT,
      deps: { spawnImpl },
    });
    expect(res.ok).toBe(true);
    expect(res.response_text).toBe("hello");
    expect(res.proposal_envelope).toBeDefined();
    expect(res.proposal_envelope?.run_id).toBe(PROPOSAL_CONTEXT.run_id);
    expect(res.proposal_envelope?.manifest_ref).toBe(PROPOSAL_CONTEXT.manifest_ref);
    expect(res.proposal_envelope?.patch_diff_ref).toBe(PROPOSAL_CONTEXT.patch_diff_ref);
    expect(res.proposal_envelope?.sandbox_cwd).toBe(PROPOSAL_CONTEXT.sandbox_cwd);
    expect(typeof observedCwd).toBe("string");
    expect(observedCwd).toBe(PROPOSAL_CONTEXT.sandbox_cwd);
  });

  it("returns invalid JSON diagnostic", async () => {
    process.env = { ...originalEnv, GEMINI_API_KEY: "dummy" };

    const helpText = "--output-format json\n--approval-mode plan\n--sandbox\n--prompt\n";
    const spawnImpl = makeSpawnImpl({
      helpText,
      runStdout: "not json",
    });

    const res = await runGeminiCli({ prompt: "hi", proposal_context: PROPOSAL_CONTEXT, deps: { spawnImpl } });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("invalid JSON output");
  });

  it("fails closed when plan approval mode is unavailable despite successful json output", async () => {
    process.env = { ...originalEnv, GEMINI_API_KEY: "dummy" };

    const helpText = "--output-format json\n--approval-mode [plan|auto]\n--sandbox\n--prompt\n";
    const spawnImpl = makeSpawnImpl({
      helpText,
      runStdout: JSON.stringify({ response: "hello" }),
      runStderr:
        'Approval mode "plan" is only available when experimental.plan is enabled. Falling back to "default".',
      runExitCode: 0,
    });

    const res = await runGeminiCli({ prompt: "hi", proposal_context: PROPOSAL_CONTEXT, deps: { spawnImpl } });
    expect(res.ok).toBe(false);
    expect(String(res.reason || "")).toContain("experimental.plan");
    expect(String(res.reason || "")).toContain("~/.gemini/settings.json");
  });

  it("reports ENOENT with install hint", async () => {
    process.env = { ...originalEnv, GEMINI_API_KEY: "dummy" };

    const spawnImpl = () => {
      const err = new Error("spawn ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    };

    const res = await runGeminiCli({ prompt: "hi", proposal_context: PROPOSAL_CONTEXT, deps: { spawnImpl: spawnImpl as any } });
    expect(res.ok).toBe(false);
    expect(String(res.reason || "")).toContain("binary not found");
  });

  it("fails closed on missing required proposal context", async () => {
    process.env = { ...originalEnv, GEMINI_API_KEY: "dummy" };

    const spawnImpl = makeSpawnImpl({
      helpText: "--output-format json\n--approval-mode plan\n--sandbox\n--prompt\n",
      runStdout: JSON.stringify({ response: "hello" }),
    });

    const res = await runGeminiCli({ prompt: "hi", deps: { spawnImpl } });
    expect(res.ok).toBe(false);
    expect(String(res.reason || "")).toContain("missing required proposal context");
  });

  it("fails closed on sandbox cwd mismatch", async () => {
    process.env = { ...originalEnv, GEMINI_API_KEY: "dummy" };

    const spawnImpl = makeSpawnImpl({
      helpText: "--output-format json\n--approval-mode plan\n--sandbox\n--prompt\n",
      runStdout: JSON.stringify({ response: "hello" }),
    });

    const res = await runGeminiCli({
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
