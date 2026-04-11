import { isStuck } from "./stuck";
import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";

export const ORCHESTRATION_TIER_SUBAGENTS = new Set([
  "aegis",
  "aegis-plan",
  "aegis-exec",
  "aegis-deep",
  "deep-plan",
]);

export type NestingGovernorAction = "allow" | "bubble_up" | "advisory_plan" | "blocked_summary";

export type NestingGovernorInput = {
  state: SessionState;
  callerAgent: string;
  targetSubagent: string;
  maxFailoverRetries: number;
  config?: OrchestratorConfig;
};

export type NestingGovernorDecision = {
  action: NestingGovernorAction;
  blocked: boolean;
  reason: string;
  targetIsOrchestrationTier: boolean;
  nextOrchestrationHopStreak: number;
  nextEscalationLevel: number;
};

function isOrchestrationTierSubagent(name: string): boolean {
  return ORCHESTRATION_TIER_SUBAGENTS.has(name.trim());
}

function computeBlocked(state: SessionState, maxFailoverRetries: number, config?: OrchestratorConfig): boolean {
  return (
    isStuck(state, config) ||
    state.loopGuard.blockedActionSignature.trim().length > 0 ||
    state.contextFailCount >= 2 ||
    state.timeoutFailCount >= 2 ||
    (state.pendingTaskFailover && state.taskFailoverCount >= maxFailoverRetries)
  );
}

export function decideNestingEscalation(input: NestingGovernorInput): NestingGovernorDecision {
  const callerIsOrchestrationTier = isOrchestrationTierSubagent(input.callerAgent);
  const targetIsOrchestrationTier = isOrchestrationTierSubagent(input.targetSubagent);
  const blockedEpochLevel = input.state.blockedEpochActive
    ? input.state.blockedEpochEscalationLevel
    : 0;
  const nextOrchestrationHopStreak = targetIsOrchestrationTier
    ? callerIsOrchestrationTier
      ? input.state.orchestrationHopStreak + 1
      : 1
    : 0;
  const blocked = computeBlocked(input.state, input.maxFailoverRetries, input.config);

  if (!targetIsOrchestrationTier || !blocked) {
    return {
      action: "allow",
      blocked,
      reason: blocked ? "blocked_non_orchestration_target" : "not_blocked",
      targetIsOrchestrationTier,
      nextOrchestrationHopStreak,
      nextEscalationLevel: blockedEpochLevel,
    };
  }

  if (input.state.blockedEpochSummaryIssued || blockedEpochLevel >= 2) {
    return {
      action: "blocked_summary",
      blocked: true,
      reason: "blocked_epoch_exhausted",
      targetIsOrchestrationTier,
      nextOrchestrationHopStreak,
      nextEscalationLevel: 3,
    };
  }

  if (input.callerAgent.trim() === "aegis" && blockedEpochLevel >= 1) {
    return {
      action: "advisory_plan",
      blocked: true,
      reason: "blocked_manager_epoch",
      targetIsOrchestrationTier,
      nextOrchestrationHopStreak,
      nextEscalationLevel: 2,
    };
  }

  return {
    action: "bubble_up",
    blocked: true,
    reason: "blocked_worker_recursion",
    targetIsOrchestrationTier,
    nextOrchestrationHopStreak,
    nextEscalationLevel: 1,
  };
}
