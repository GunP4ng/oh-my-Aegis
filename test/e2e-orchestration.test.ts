import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import OhMyAegisPlugin from "../src/index";

const roots: string[] = [];
const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
  delete process.env.OPENCODE_CLAUDE_AUTH_TOOL_CALL_CACHE_DIR;
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

async function exec(hooks: any, toolName: string, args: Record<string, unknown>, sessionID = "s1") {
  const raw = await hooks.tool?.[toolName]?.execute(args, { sessionID } as never);
  return JSON.parse(raw ?? "{}");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function writeGovernanceDiffArtifact(projectDir: string, runID: string): { patchDiffRef: string; digest: string } {
  const patchDiffRef = `.Aegis/runs/${runID}/patches/proposal.diff`;
  const patchDir = join(projectDir, ".Aegis", "runs", runID, "patches");
  mkdirSync(patchDir, { recursive: true });
  const diffText = [
    "diff --git a/src/governance.ts b/src/governance.ts",
    "index 1111111..2222222 100644",
    "--- a/src/governance.ts",
    "+++ b/src/governance.ts",
    "@@ -1 +1,2 @@",
    " export const governance = true;",
    "+export const gate = 'strict';",
    "",
  ].join("\n");
  const absDiffPath = join(projectDir, patchDiffRef);
  writeFileSync(absDiffPath, diffText, "utf-8");
  const digest = createHash("sha256").update(readFileSync(absDiffPath)).digest("hex");
  return { patchDiffRef, digest };
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

  it("restores cached tool arguments before execution when runtime drops them", async () => {
    const { projectDir } = setup();
    const hooks = await loadHooks(projectDir);
    const cacheDir = join(projectDir, ".tool-call-cache");
    mkdirSync(cacheDir, { recursive: true });
    process.env.OPENCODE_CLAUDE_AUTH_TOOL_CALL_CACHE_DIR = cacheDir;

    writeFileSync(
      join(cacheDir, "call_skill_restore.json"),
      JSON.stringify({
        id: "call/skill:restore",
        name: "skill",
        arguments: { name: "javascript-mastery" },
      }),
      "utf-8",
    );
    writeFileSync(
      join(cacheDir, "call_read_restore.json"),
      JSON.stringify({
        id: "call read restore",
        name: "read",
        arguments: { filePath: "/tmp/example.txt" },
      }),
      "utf-8",
    );

    const skillOutput = { args: {} };
    await hooks["tool.execute.before"]?.(
      { tool: "skill", sessionID: "s-restore", callID: "internal-skill-call", args: {} },
      skillOutput,
    );
    expect((skillOutput.args as Record<string, unknown>).name).toBe("javascript-mastery");

    const readOutput = { args: {} };
    await hooks["tool.execute.before"]?.(
      { tool: "read", sessionID: "s-restore", callID: "internal-read-call", args: {} },
      readOutput,
    );
    expect((readOutput.args as Record<string, unknown>).filePath).toBe("/tmp/example.txt");
  });

  it("governance verify chain progresses with linked proposal/review/council/apply/audit artifacts", async () => {
    const { projectDir } = setup();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" }, "s-gov-pass");

    const runID = "run-gov-pass";
    const manifestRef = `.Aegis/runs/${runID}/run-manifest.json`;
    const { patchDiffRef, digest: patchDigest } = writeGovernanceDiffArtifact(projectDir, runID);
    const sandboxCwd = join(projectDir, ".Aegis", "runs", runID, "sandbox");
    const proposalText = "patch proposal for governance progression e2e";

    const propose = await exec(
      hooks,
      "ctf_patch_propose",
      {
        proposal_text: proposalText,
        run_id: runID,
        manifest_ref: manifestRef,
        patch_diff_ref: patchDiffRef,
        sandbox_cwd: sandboxCwd,
        author_model: "openai/gpt-5.3-codex",
        risk_score: 100,
        file_count: 3,
        total_loc: 90,
      },
      "s-gov-pass"
    );
    expect(propose.ok).toBe(true);
    expect(propose.reason).toBe("governance_patch_proposal_recorded");
    expect(propose.artifacts.refs).toContain(`run_id=${runID}`);
    expect(propose.artifacts.refs).toContain(`manifest_ref=${manifestRef}`);
    expect(propose.artifacts.refs).toContain(`patch_diff_ref=${patchDiffRef}`);

    const review = await exec(
      hooks,
      "ctf_patch_review",
      {
        patch_sha256: patchDigest,
        author_model: "openai/gpt-5.3-codex",
        reviewer_model: "google/gemini-2.5-pro",
        verdict: "approved",
      },
      "s-gov-pass"
    );
    expect(review.ok).toBe(true);
    expect(review.reason).toBe("governance_review_recorded");
    expect(review.artifacts.refs).toContain(`run_id=${runID}`);

    const auditBlocked = await exec(hooks, "ctf_patch_audit", {}, "s-gov-pass");
    expect(auditBlocked.ok).toBe(false);
    expect(auditBlocked.reason).toBe("governance_council_required_missing_artifact");
    expect(auditBlocked.checks.council_required).toBe(true);
    expect(auditBlocked.checks.council_blocked).toBe(true);

    const applyBlocked = await exec(hooks, "ctf_patch_apply", {}, "s-gov-pass");
    expect(applyBlocked.ok).toBe(false);
    expect(applyBlocked.reason).toBe("governance_council_required_missing_artifact");

    const councilDecisionRef = `.Aegis/runs/${runID}/council/decision.json`;
    await hooks["tool.execute.after"]?.(
      { tool: "task", sessionID: "s-gov-pass", callID: "gov-council-1", args: {} },
      {
        title: "council decision",
        output: JSON.stringify({
          council_decision_artifact_ref: councilDecisionRef,
          council_decided_at: Date.now(),
        }),
        metadata: {},
      }
    );

    const auditReady = await exec(hooks, "ctf_patch_audit", {}, "s-gov-pass");
    expect(auditReady.ok).toBe(true);
    expect(auditReady.reason).toBe("governance_apply_ready");
    expect(auditReady.checks.council_required).toBe(true);
    expect(auditReady.checks.council_blocked).toBe(false);
    expect(auditReady.artifacts.refs).toContain(`run_id=${runID}`);
    expect(auditReady.artifacts.paths).toContain(councilDecisionRef);

    const apply = await exec(hooks, "ctf_patch_apply", {}, "s-gov-pass");
    expect(apply.ok).toBe(true);
    expect(apply.reason).toBe("governance_apply_preflight_passed");
    expect(apply.apply_lock.owner_session_id).toBe("s-gov-pass");
    expect(apply.artifacts.refs).toContain(`run_id=${runID}`);
    expect(apply.artifacts.paths).toContain(councilDecisionRef);
  });

  it("governance blocked gates deny at review, council, and apply lock stages", async () => {
    const { projectDir } = setup();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" }, "s-review");
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" }, "s-council");
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" }, "s-lock");

    const runReview = "run-gov-review-block";
    const reviewPatch = writeGovernanceDiffArtifact(projectDir, runReview);
    const reviewProposal = "review gate block proposal";
    await exec(
      hooks,
      "ctf_patch_propose",
      {
        proposal_text: reviewProposal,
        run_id: runReview,
        manifest_ref: `.Aegis/runs/${runReview}/run-manifest.json`,
        patch_diff_ref: reviewPatch.patchDiffRef,
        sandbox_cwd: join(projectDir, ".Aegis", "runs", runReview, "sandbox"),
        author_model: "openai/gpt-5.3-codex",
        risk_score: 5,
      },
      "s-review"
    );
    const reviewBlocked = await exec(hooks, "ctf_patch_apply", {}, "s-review");
    expect(reviewBlocked.ok).toBe(false);
    expect(reviewBlocked.reason).toBe("governance_review_not_approved:pending");

    const runCouncil = "run-gov-council-block";
    const councilPatch = writeGovernanceDiffArtifact(projectDir, runCouncil);
    const councilProposal = "council required block proposal";
    await exec(
      hooks,
      "ctf_patch_propose",
      {
        proposal_text: councilProposal,
        run_id: runCouncil,
        manifest_ref: `.Aegis/runs/${runCouncil}/run-manifest.json`,
        patch_diff_ref: councilPatch.patchDiffRef,
        sandbox_cwd: join(projectDir, ".Aegis", "runs", runCouncil, "sandbox"),
        author_model: "openai/gpt-5.3-codex",
        risk_score: 100,
      },
      "s-council"
    );
    await exec(
      hooks,
      "ctf_patch_review",
      {
        patch_sha256: councilPatch.digest,
        author_model: "openai/gpt-5.3-codex",
        reviewer_model: "google/gemini-2.5-pro",
        verdict: "approved",
      },
      "s-council"
    );
    const councilBlocked = await exec(hooks, "ctf_patch_apply", {}, "s-council");
    expect(councilBlocked.ok).toBe(false);
    expect(councilBlocked.reason).toBe("governance_council_required_missing_artifact");

    const runLock = "run-gov-lock-block";
    const lockPatch = writeGovernanceDiffArtifact(projectDir, runLock);
    const lockProposal = "apply lock block proposal";
    await exec(
      hooks,
      "ctf_patch_propose",
      {
        proposal_text: lockProposal,
        run_id: runLock,
        manifest_ref: `.Aegis/runs/${runLock}/run-manifest.json`,
        patch_diff_ref: lockPatch.patchDiffRef,
        sandbox_cwd: join(projectDir, ".Aegis", "runs", runLock, "sandbox"),
        author_model: "openai/gpt-5.3-codex",
        risk_score: 5,
      },
      "s-lock"
    );
    await exec(
      hooks,
      "ctf_patch_review",
      {
        patch_sha256: lockPatch.digest,
        author_model: "openai/gpt-5.3-codex",
        reviewer_model: "google/gemini-2.5-pro",
        verdict: "approved",
      },
      "s-lock"
    );

    const lockPath = join(projectDir, ".Aegis", "runs", "locks", "single-writer-apply.lock");
    mkdirSync(join(projectDir, ".Aegis", "runs", "locks"), { recursive: true });
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        version: 1,
        holder: {
          pid: 654321,
          sessionID: "external-holder",
          acquiredAtMs: Date.now(),
        },
        stalePolicy: { staleAfterMs: 30_000 },
        audit: {
          acquiredAtMs: Date.now(),
          recovered: false,
        },
      })}\n`,
      "utf-8"
    );

    const lockBlocked = await exec(hooks, "ctf_patch_apply", {}, "s-lock");
    expect(lockBlocked.ok).toBe(false);
    expect((lockBlocked.reason as string).startsWith("governance_apply_lock_denied:holder_session=external-holder")).toBe(true);
  });

  it("holds apply lock across real apply critical section and denies concurrent apply", async () => {
    const { projectDir } = setup();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" }, "s-concurrent");

    const runID = "run-gov-concurrent";
    const { patchDiffRef, digest: patchDigest } = writeGovernanceDiffArtifact(projectDir, runID);
    const manifestRef = `.Aegis/runs/${runID}/run-manifest.json`;
    const sandboxCwd = join(projectDir, ".Aegis", "runs", runID, "sandbox");
    await exec(
      hooks,
      "ctf_patch_propose",
      {
        proposal_text: "concurrency lock coverage",
        run_id: runID,
        manifest_ref: manifestRef,
        patch_diff_ref: patchDiffRef,
        sandbox_cwd: sandboxCwd,
        author_model: "openai/gpt-5.3-codex",
        risk_score: 5,
      },
      "s-concurrent"
    );
    await exec(
      hooks,
      "ctf_patch_review",
      {
        patch_sha256: patchDigest,
        author_model: "openai/gpt-5.3-codex",
        reviewer_model: "google/gemini-2.5-pro",
        verdict: "approved",
      },
      "s-concurrent"
    );

    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s-concurrent", callID: "apply-1", args: {} },
      { args: { command: "bun run apply" } }
    );

    let deniedReason = "";
    try {
      await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "s-concurrent", callID: "apply-2", args: {} },
        { args: { command: "bun run apply" } }
      );
    } catch (error) {
      deniedReason = String(error);
    }
    expect(deniedReason.includes("governance_apply_blocked:governance_apply_lock_denied")).toBe(true);

    await hooks["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s-concurrent", callID: "apply-1", args: {} },
      { title: "apply done", output: "ok", metadata: {} }
    );
  });

  it("lock cleanup recovers from post-acquire prehook deny without orphan lock", async () => {
    const { projectDir } = setup();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" }, "s-lock-cleanup");

    const runID = "run-gov-lock-cleanup";
    const { patchDiffRef, digest: patchDigest } = writeGovernanceDiffArtifact(projectDir, runID);
    const manifestRef = `.Aegis/runs/${runID}/run-manifest.json`;
    const sandboxCwd = join(projectDir, ".Aegis", "runs", runID, "sandbox");
    await exec(
      hooks,
      "ctf_patch_propose",
      {
        proposal_text: "lock cleanup regression",
        run_id: runID,
        manifest_ref: manifestRef,
        patch_diff_ref: patchDiffRef,
        sandbox_cwd: sandboxCwd,
        author_model: "openai/gpt-5.3-codex",
        risk_score: 5,
      },
      "s-lock-cleanup"
    );
    await exec(
      hooks,
      "ctf_patch_review",
      {
        patch_sha256: patchDigest,
        author_model: "openai/gpt-5.3-codex",
        reviewer_model: "google/gemini-2.5-pro",
        verdict: "approved",
      },
      "s-lock-cleanup"
    );

    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(
      join(projectDir, ".claude", "settings.json"),
      `${JSON.stringify({ permissions: { deny: ["Bash(*nmap*)"] } }, null, 2)}\n`,
      "utf-8"
    );

    let firstDenyReason = "";
    try {
      await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "s-lock-cleanup", callID: "apply-deny-1", args: {} },
        { args: { command: "bun run apply && nmap -sV 127.0.0.1" } }
      );
    } catch (error) {
      firstDenyReason = String(error);
    }
    expect(firstDenyReason.includes("Claude settings denied Bash")).toBe(true);
    expect(firstDenyReason.includes("governance_apply_blocked:governance_apply_lock_denied")).toBe(false);

    let secondDenyReason = "";
    try {
      await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "s-lock-cleanup", callID: "apply-deny-2", args: {} },
        { args: { command: "bun run apply" } }
      );
    } catch (error) {
      secondDenyReason = String(error);
    }
    expect(secondDenyReason.includes("governance_apply_blocked:governance_apply_lock_denied")).toBe(false);

    await hooks["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s-lock-cleanup", callID: "apply-deny-2", args: {} },
      { title: "apply cleanup done", output: "ok", metadata: {} }
    );
  });

  it("binds governance digest to diff artifact bytes, not proposal text", async () => {
    const { projectDir } = setup();
    const hooks = await loadHooks(projectDir);
    await exec(hooks, "ctf_orch_set_mode", { mode: "CTF" }, "s-digest-bind");

    const runID = "run-gov-digest-bind";
    const { patchDiffRef } = writeGovernanceDiffArtifact(projectDir, runID);
    const proposalText = "this text must not drive digest";
    const propose = await exec(
      hooks,
      "ctf_patch_propose",
      {
        proposal_text: proposalText,
        run_id: runID,
        manifest_ref: `.Aegis/runs/${runID}/run-manifest.json`,
        patch_diff_ref: patchDiffRef,
        sandbox_cwd: join(projectDir, ".Aegis", "runs", runID, "sandbox"),
        author_model: "openai/gpt-5.3-codex",
      },
      "s-digest-bind"
    );
    expect(propose.ok).toBe(true);

    const wrongReview = await exec(
      hooks,
      "ctf_patch_review",
      {
        patch_sha256: sha256Hex(proposalText),
        author_model: "openai/gpt-5.3-codex",
        reviewer_model: "google/gemini-2.5-pro",
        verdict: "approved",
      },
      "s-digest-bind"
    );
    expect(wrongReview.ok).toBe(false);
    expect(wrongReview.reason).toBe("review_patch_sha256_mismatch");
  });
});
