export type Mode = "CTF" | "BOUNTY";

export type Phase = "SCAN" | "PLAN" | "EXECUTE";

export type ThinkMode = "none" | "think" | "ultrathink";

export const TARGET_TYPES = [
  "WEB_API",
  "WEB3",
  "PWN",
  "REV",
  "CRYPTO",
  "FORENSICS",
  "MISC",
  "UNKNOWN",
] as const;

export type TargetType = (typeof TARGET_TYPES)[number];

export const FAILURE_REASONS = [
  "none",
  "verification_mismatch",
  "tooling_timeout",
  "context_overflow",
  "hypothesis_stall",
  "unsat_claim",
  "static_dynamic_contradiction",
  "exploit_chain",
  "environment",
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export interface ModelHealthEntry {
  unhealthySince: number;
  reason: string;
}

export interface SubagentDispatchHealth {
  successCount: number;
  retryableFailureCount: number;
  hardFailureCount: number;
  consecutiveFailureCount: number;
  lastOutcomeAt: number;
}

export interface SubagentProfileOverride {
  model: string;
  variant: string;
}

export type DispatchOutcomeType = "success" | "retryable_failure" | "hard_failure";

export interface SessionState {
  mode: Mode;
  modeExplicit: boolean;
  ultraworkEnabled: boolean;
  thinkMode: ThinkMode;
  autoLoopEnabled: boolean;
  autoLoopIterations: number;
  autoLoopStartedAt: number;
  autoLoopLastPromptAt: number;
  phase: Phase;
  targetType: TargetType;
  scopeConfirmed: boolean;
  candidatePendingVerification: boolean;
  latestCandidate: string;
  latestVerified: string;
  hypothesis: string;
  alternatives: string[];
  noNewEvidenceLoops: number;
  samePayloadLoops: number;
  verifyFailCount: number;
  readonlyInconclusiveCount: number;
  contextFailCount: number;
  timeoutFailCount: number;
  envParityChecked: boolean;
  envParityAllMatch: boolean;
  envParitySummary: string;
  envParityUpdatedAt: number;
  recentEvents: string[];
  lastTaskCategory: string;
  lastTaskRoute: string;
  lastTaskSubagent: string;
  lastTaskModel: string;
  lastTaskVariant: string;
  pendingTaskFailover: boolean;
  taskFailoverCount: number;
  dispatchHealthBySubagent: Record<string, SubagentDispatchHealth>;
  subagentProfileOverrides: Record<string, SubagentProfileOverride>;
  modelHealthByModel: Record<string, ModelHealthEntry>;
  lastFailureReason: FailureReason;
  lastFailureSummary: string;
  lastFailedRoute: string;
  lastFailureAt: number;
  failureReasonCounts: Record<FailureReason, number>;
  lastUpdatedAt: number;
}

export const DEFAULT_STATE: SessionState = {
  mode: "BOUNTY",
  modeExplicit: false,
  ultraworkEnabled: false,
  thinkMode: "none",
  autoLoopEnabled: false,
  autoLoopIterations: 0,
  autoLoopStartedAt: 0,
  autoLoopLastPromptAt: 0,
  phase: "SCAN",
  targetType: "UNKNOWN",
  scopeConfirmed: false,
  candidatePendingVerification: false,
  latestCandidate: "",
  latestVerified: "",
  hypothesis: "",
  alternatives: [],
  noNewEvidenceLoops: 0,
  samePayloadLoops: 0,
  verifyFailCount: 0,
  readonlyInconclusiveCount: 0,
  contextFailCount: 0,
  timeoutFailCount: 0,
  envParityChecked: false,
  envParityAllMatch: false,
  envParitySummary: "",
  envParityUpdatedAt: 0,
  recentEvents: [],
  lastTaskCategory: "",
  lastTaskRoute: "",
  lastTaskSubagent: "",
  lastTaskModel: "",
  lastTaskVariant: "",
  pendingTaskFailover: false,
  taskFailoverCount: 0,
  dispatchHealthBySubagent: {},
  subagentProfileOverrides: {},
  modelHealthByModel: {},
  lastFailureReason: "none",
  lastFailureSummary: "",
  lastFailedRoute: "",
  lastFailureAt: 0,
  failureReasonCounts: {
    none: 0,
    verification_mismatch: 0,
    tooling_timeout: 0,
    context_overflow: 0,
    hypothesis_stall: 0,
    unsat_claim: 0,
    static_dynamic_contradiction: 0,
    exploit_chain: 0,
    environment: 0,
  },
  lastUpdatedAt: Date.now(),
};

export type SessionEvent =
  | "scan_completed"
  | "plan_completed"
  | "candidate_found"
  | "verify_success"
  | "verify_fail"
  | "no_new_evidence"
  | "same_payload_repeat"
  | "new_evidence"
  | "readonly_inconclusive"
  | "scope_confirmed"
  | "context_length_exceeded"
  | "timeout"
  | "unsat_claim"
  | "static_dynamic_contradiction"
  | "reset_loop";
