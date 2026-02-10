import { describe, expect, it } from "bun:test";
import { OrchestratorConfigSchema } from "../src/config/schema";
import { decideAutoDispatch, requiredDispatchSubagents } from "../src/orchestration/task-dispatch";
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
});
