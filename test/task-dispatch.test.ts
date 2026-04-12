import { describe, expect, it } from "bun:test";
import { OrchestratorConfigSchema } from "../src/config/schema";
import {
  bindIndependentReviewDecision,
  evaluateIndependentReviewGate,
} from "../src/orchestration/review-gate";
import {
  decideAutoDispatch,
  isNonOverridableSubagent,
  requiredDispatchSubagents,
  shapeTaskDispatch,
} from "../src/orchestration/task-dispatch";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";

function makeState(overrides: Partial<SessionState>): SessionState {
  return { ...DEFAULT_STATE, ...overrides, lastUpdatedAt: 0 };
}

describe("task-dispatch", () => {
  it("maps route subagent for normal dispatch", () => {
    const decision = decideAutoDispatch("ctf-research", makeState({ mode: "CTF" }), 2);
    expect(decision.subagent_type).toBe("ctf-research");
  });

  it("maps domain-specific route names directly", () => {
    const decision = decideAutoDispatch("ctf-forensics", makeState({ mode: "CTF" }), 2);
    expect(decision.subagent_type).toBe("ctf-forensics");
  });

  it("uses fallback subagent when pending failover is set", () => {
    const decision = decideAutoDispatch(
      "ctf-solve",
      makeState({ mode: "CTF", targetType: "WEB_API", pendingTaskFailover: true, taskFailoverCount: 0 }),
      3
    );
    expect(decision.subagent_type).toBe("ctf-research");
  });

  it("stops fallback once max retries are reached", () => {
    const decision = decideAutoDispatch(
      "ctf-solve",
      makeState({ mode: "CTF", targetType: "WEB_API", pendingTaskFailover: true, taskFailoverCount: 3 }),
      3
    );
    expect(decision.subagent_type).toBe("ctf-solve");
  });

  it("uses target-specific CTF fallback for non-web targets", () => {
    const decision = decideAutoDispatch(
      "ctf-solve",
      makeState({ mode: "CTF", targetType: "FORENSICS", pendingTaskFailover: true, taskFailoverCount: 0 }),
      2
    );
    expect(decision.subagent_type).toBe("ctf-forensics");
  });

  it("keeps mapped subagent when operational feedback is disabled", () => {
    const config = OrchestratorConfigSchema.parse({
      auto_dispatch: {
        enabled: true,
        preserve_user_category: true,
        max_failover_retries: 2,
        operational_feedback_enabled: false,
        operational_feedback_consecutive_failures: 1,
      },
    });
    const decision = decideAutoDispatch(
      "ctf-web3",
      makeState({
        mode: "CTF",
        targetType: "WEB3",
        dispatchHealthBySubagent: {
          "ctf-web3": {
            successCount: 0,
            retryableFailureCount: 0,
            hardFailureCount: 2,
            consecutiveFailureCount: 2,
            lastOutcomeAt: 1,
          },
        },
      }),
      2,
      config
    );
    expect(decision.subagent_type).toBe("ctf-web3");
  });

  it("switches to healthier subagent when mapped one is failing consecutively", () => {
    const config = OrchestratorConfigSchema.parse({
      auto_dispatch: {
        enabled: true,
        preserve_user_category: true,
        max_failover_retries: 2,
        operational_feedback_enabled: true,
        operational_feedback_consecutive_failures: 1,
      },
    });
    const decision = decideAutoDispatch(
      "ctf-web3",
      makeState({
        mode: "CTF",
        targetType: "WEB3",
        dispatchHealthBySubagent: {
          "ctf-web3": {
            successCount: 0,
            retryableFailureCount: 0,
            hardFailureCount: 2,
            consecutiveFailureCount: 2,
            lastOutcomeAt: 1,
          },
          "ctf-research": {
            successCount: 1,
            retryableFailureCount: 0,
            hardFailureCount: 0,
            consecutiveFailureCount: 0,
            lastOutcomeAt: 1,
          },
        },
      }),
      2,
      config
    );
    expect(decision.subagent_type).toBe("ctf-research");
  });

  it("does not override strict verification routes", () => {
    const config = OrchestratorConfigSchema.parse({
      auto_dispatch: {
        enabled: true,
        preserve_user_category: true,
        max_failover_retries: 2,
        operational_feedback_enabled: true,
        operational_feedback_consecutive_failures: 1,
      },
    });
    const decision = decideAutoDispatch(
      "ctf-verify",
      makeState({
        mode: "CTF",
        dispatchHealthBySubagent: {
          "ctf-verify": {
            successCount: 0,
            retryableFailureCount: 0,
            hardFailureCount: 3,
            consecutiveFailureCount: 3,
            lastOutcomeAt: 1,
          },
        },
      }),
      2,
      config
    );
    expect(decision.subagent_type).toBe("ctf-verify");
  });

  it("treats verification aliases as non-overridable", () => {
    expect(isNonOverridableSubagent("ctf-verify--flash")).toBe(true);
    const decision = decideAutoDispatch(
      "ctf-verify--flash",
      makeState({ mode: "CTF" }),
      2
    );
    expect(decision.subagent_type).toBe("ctf-verify--flash");
    expect(decision.reason).toContain("non-overridable");
  });

  it("keeps md-scribe route pinned during dispatch", () => {
    expect(isNonOverridableSubagent("md-scribe")).toBe(true);
    const decision = decideAutoDispatch(
      "md-scribe",
      makeState({ mode: "CTF" }),
      2
    );
    expect(decision.subagent_type).toBe("md-scribe");
    expect(decision.reason).toContain("non-overridable");
  });

  it("treats governance suffixed routes as non-overridable", () => {
    expect(isNonOverridableSubagent("aegis-plan--governance-review-required")).toBe(true);
    expect(isNonOverridableSubagent("aegis-plan--governance-council-required")).toBe(true);
    expect(isNonOverridableSubagent("aegis-exec--governance-apply-ready")).toBe(true);
  });

  it("keeps governance non-overridable route pinned during dispatch", () => {
    const decision = decideAutoDispatch(
      "aegis-plan--governance-council-required",
      makeState({ mode: "CTF" }),
      2
    );
    expect(decision.subagent_type).toBe("aegis-plan--governance-council-required");
    expect(decision.reason).toContain("non-overridable");
  });

  it("collects required subagents for all CTF target domains", () => {
    const config = OrchestratorConfigSchema.parse({});
    const required = requiredDispatchSubagents(config);
    expect(required).toContain("ctf-web");
    expect(required).toContain("ctf-web3");
    expect(required).toContain("ctf-pwn");
    expect(required).toContain("ctf-rev");
    expect(required).toContain("ctf-crypto");
    expect(required).toContain("ctf-forensics");
  });

  it("keeps generic auto-parallel scan ownership on the manager", () => {
    const config = OrchestratorConfigSchema.parse({
      parallel: {
        auto_dispatch_scan: true,
      },
    });

    const shaped = shapeTaskDispatch({
      args: { prompt: "start scan" },
      state: makeState({
        mode: "CTF",
        targetType: "WEB_API",
        phase: "SCAN",
      }),
      config,
      callerAgent: "aegis",
      sessionID: "scan-manager",
      decisionPrimary: "ctf-web",
      searchModeRequested: false,
      searchModeGuidancePending: false,
      hasActiveParallelGroup: false,
      availableSkills: new Set<string>(),
      isWindows: false,
      resolveSharedChannelPrompt: () => "",
    });

    expect(shaped.args.subagent_type).toBeUndefined();
    expect(String(shaped.args.prompt)).toContain("[oh-my-Aegis auto-parallel]");
    expect(String(shaped.args.prompt)).toContain("ctf_parallel_dispatch plan=scan");
    expect(shaped.storeInstructions.some((instruction) => JSON.stringify(instruction).includes("aegis-deep"))).toBe(false);
  });

  it("keeps generic auto-parallel hypothesis ownership on the manager", () => {
    const config = OrchestratorConfigSchema.parse({
      parallel: {
        auto_dispatch_hypothesis: true,
      },
    });

    const shaped = shapeTaskDispatch({
      args: { prompt: "test competing hypotheses" },
      state: makeState({
        mode: "CTF",
        targetType: "UNKNOWN",
        phase: "PLAN",
        alternatives: ["hypothesis A", "hypothesis B"],
      }),
      config,
      callerAgent: "aegis",
      sessionID: "hypothesis-manager",
      decisionPrimary: "ctf-hypothesis",
      searchModeRequested: false,
      searchModeGuidancePending: false,
      hasActiveParallelGroup: false,
      availableSkills: new Set<string>(),
      isWindows: false,
      resolveSharedChannelPrompt: () => "",
    });

    expect(shaped.args.subagent_type).toBeUndefined();
    expect(String(shaped.args.prompt)).toContain("[oh-my-Aegis auto-parallel]");
    expect(String(shaped.args.prompt)).toContain("ctf_parallel_dispatch plan=hypothesis");
    expect(String(shaped.args.prompt)).toContain("\"hypothesis\":\"hypothesis A\"");
    expect(shaped.storeInstructions.some((instruction) => JSON.stringify(instruction).includes("aegis-deep"))).toBe(false);
  });

  it("keeps REV/PWN deep-worker auto-parallel on aegis-deep", () => {
    const config = OrchestratorConfigSchema.parse({});

    const shaped = shapeTaskDispatch({
      args: { prompt: "continue rev execution" },
      state: makeState({
        mode: "CTF",
        targetType: "REV",
        phase: "EXECUTE",
      }),
      config,
      callerAgent: "aegis",
      sessionID: "deep-worker-rev",
      decisionPrimary: "ctf-rev",
      searchModeRequested: false,
      searchModeGuidancePending: false,
      hasActiveParallelGroup: false,
      availableSkills: new Set<string>(),
      isWindows: false,
      resolveSharedChannelPrompt: () => "",
    });

    expect(shaped.args.subagent_type).toBe("aegis-deep");
    expect(String(shaped.args.prompt)).toContain("ctf_parallel_dispatch plan=deep_worker");
    expect(shaped.storeInstructions.some((instruction) => JSON.stringify(instruction).includes("aegis-deep"))).toBe(true);
  });
});

describe("independent review gate", () => {
  it("approves review when provider families are independent and digest/binding match", () => {
    const config = OrchestratorConfigSchema.parse({});
    const digest = "a".repeat(64);
    const decision = bindIndependentReviewDecision({
      patch_sha256: digest,
      author_model: "openai/gpt-5.3-codex",
      reviewer_model: "anthropic/claude-sonnet-4.5",
      verdict: "approved",
      reviewed_at: 1,
    });

    const result = evaluateIndependentReviewGate({
      decision,
      expected_patch_sha256: digest,
      config,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.author_provider_family).toBe("openai");
    expect(result.reviewer_provider_family).toBe("anthropic");
  });

  it("deny fails closed when reviewer is from same provider family", () => {
    const config = OrchestratorConfigSchema.parse({});
    const digest = "b".repeat(64);
    const decision = bindIndependentReviewDecision({
      patch_sha256: digest,
      author_model: "openai/gpt-5.3-codex",
      reviewer_model: "openai/gpt-5.2",
      verdict: "approved",
      reviewed_at: 2,
    });

    const result = evaluateIndependentReviewGate({
      decision,
      expected_patch_sha256: digest,
      config,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("review_provider_family_separation_required:openai");
  });

  it("deny fails closed when review decision digest is stale or mismatched", () => {
    const config = OrchestratorConfigSchema.parse({});
    const decision = bindIndependentReviewDecision({
      patch_sha256: "c".repeat(64),
      author_model: "openai/gpt-5.3-codex",
      reviewer_model: "anthropic/claude-sonnet-4.5",
      verdict: "approved",
      reviewed_at: 3,
    });

    const result = evaluateIndependentReviewGate({
      decision,
      expected_patch_sha256: "d".repeat(64),
      config,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("review_patch_sha256_mismatch");
  });

  it("deny fails closed when cryptographic binding does not match signed decision content", () => {
    const config = OrchestratorConfigSchema.parse({});
    const digest = "e".repeat(64);
    const decision = bindIndependentReviewDecision({
      patch_sha256: digest,
      author_model: "openai/gpt-5.3-codex",
      reviewer_model: "anthropic/claude-sonnet-4.5",
      verdict: "approved",
      reviewed_at: 4,
    });
    const tampered = {
      ...decision,
      reviewer_model: "google/gemini-2.5-pro",
    };

    const result = evaluateIndependentReviewGate({
      decision: tampered,
      expected_patch_sha256: digest,
      config,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("review_binding_sha256_mismatch");
  });

  it("deny fails closed when review verdict is rejected", () => {
    const config = OrchestratorConfigSchema.parse({});
    const digest = "f".repeat(64);
    const decision = bindIndependentReviewDecision({
      patch_sha256: digest,
      author_model: "openai/gpt-5.3-codex",
      reviewer_model: "anthropic/claude-sonnet-4.5",
      verdict: "rejected",
      reviewed_at: 5,
    });

    const result = evaluateIndependentReviewGate({
      decision,
      expected_patch_sha256: digest,
      config,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("review_verdict_rejected");
  });
});
