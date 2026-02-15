export type Mode = "CTF" | "BOUNTY";
export type Phase = "SCAN" | "PLAN" | "EXECUTE";
export type ThinkMode = "none" | "think" | "ultrathink";
export declare const TARGET_TYPES: readonly ["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"];
export type TargetType = (typeof TARGET_TYPES)[number];
export declare const FAILURE_REASONS: readonly ["none", "verification_mismatch", "tooling_timeout", "context_overflow", "hypothesis_stall", "exploit_chain", "environment"];
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
export type DispatchOutcomeType = "success" | "retryable_failure" | "hard_failure";
export interface SessionState {
    mode: Mode;
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
    recentEvents: string[];
    lastTaskCategory: string;
    lastTaskRoute: string;
    lastTaskSubagent: string;
    pendingTaskFailover: boolean;
    taskFailoverCount: number;
    dispatchHealthBySubagent: Record<string, SubagentDispatchHealth>;
    modelHealthByModel: Record<string, ModelHealthEntry>;
    lastFailureReason: FailureReason;
    lastFailureSummary: string;
    lastFailedRoute: string;
    lastFailureAt: number;
    failureReasonCounts: Record<FailureReason, number>;
    lastUpdatedAt: number;
}
export declare const DEFAULT_STATE: SessionState;
export type SessionEvent = "scan_completed" | "plan_completed" | "candidate_found" | "verify_success" | "verify_fail" | "no_new_evidence" | "same_payload_repeat" | "new_evidence" | "readonly_inconclusive" | "scope_confirmed" | "context_length_exceeded" | "timeout" | "reset_loop";
