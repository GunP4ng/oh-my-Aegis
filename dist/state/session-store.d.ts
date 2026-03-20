import { type AegisTodoEntry, type DispatchOutcomeType, type FailureReason, type IntentType, type Mode, type ProblemStateClass, type SessionEvent, type SessionState, type SharedChannelMessage, type SubagentProfileOverride, type TargetType, type ThinkMode } from "./types";
export declare const RECENT_EVENTS_LIMIT = 30;
export type StoreChangeReason = "set_mode" | "set_ultrawork_enabled" | "set_think_mode" | "set_auto_loop_enabled" | "record_auto_loop_prompt" | "set_target_type" | "set_hypothesis" | "set_alternatives" | "set_env_parity" | "set_env_parity_required" | "set_rev_risk" | "set_candidate" | "set_verified" | "set_acceptance_evidence" | "set_candidate_level" | "record_failure" | "set_failure_details" | "clear_failure" | "set_last_task_category" | "set_last_dispatch" | "record_contradiction_artifacts" | "record_dispatch_outcome" | "set_subagent_profile_override" | "clear_subagent_profile_override" | "trigger_task_failover" | "consume_task_failover" | "clear_task_failover" | "mark_model_unhealthy" | "mark_model_healthy" | "stage_todo_runtime" | "commit_todo_runtime" | "clear_loop_guard" | "publish_shared_message" | "set_solve_lane" | "manual_verify_success" | "set_intent" | "set_problem_state" | SessionEvent;
export interface StoreChangeEvent {
    sessionID: string;
    state: SessionState;
    reason: StoreChangeReason;
}
export interface SessionStorePersistMetric {
    trigger: "immediate" | "timer" | "manual";
    durationMs: number;
    stateCount: number;
    payloadBytes: number;
    asyncPersistence: boolean;
    failed: boolean;
    reason: string;
}
export interface SessionStoreOptions {
    asyncPersistence?: boolean;
    flushDelayMs?: number;
    onPersist?: (metric: SessionStorePersistMetric) => void;
}
export type StoreObserver = (event: StoreChangeEvent) => void;
export declare class SessionStore {
    private readonly filePath;
    private readonly stateMap;
    private readonly observer?;
    private readonly defaultMode;
    private readonly asyncPersistence;
    private readonly onPersist?;
    private persistenceDegraded;
    private observerDegraded;
    private persistenceBlockedByFutureSchema;
    private readonly persistFlusher;
    constructor(baseDirectory: string, observer?: StoreObserver, defaultMode?: Mode, stateRootDir?: string, options?: SessionStoreOptions);
    flushNow(): void;
    get(sessionID: string): SessionState;
    update(sessionID: string, partial: Partial<SessionState>): SessionState;
    setMode(sessionID: string, mode: Mode): SessionState;
    setUltraworkEnabled(sessionID: string, enabled: boolean): SessionState;
    setThinkMode(sessionID: string, mode: ThinkMode): SessionState;
    setAutoLoopEnabled(sessionID: string, enabled: boolean): SessionState;
    recordAutoLoopPrompt(sessionID: string): SessionState;
    setTargetType(sessionID: string, targetType: TargetType): SessionState;
    setHypothesis(sessionID: string, hypothesis: string): SessionState;
    setAlternatives(sessionID: string, alternatives: string[]): SessionState;
    setEnvParity(sessionID: string, allMatch: boolean, summary?: string): SessionState;
    setEnvParityRequired(sessionID: string, required: boolean, reason?: string): SessionState;
    setRevRisk(sessionID: string, risk: {
        vmSuspected: boolean;
        score: number;
        signals: string[];
        staticTrust: number;
    }): SessionState;
    setCandidate(sessionID: string, candidate: string): SessionState;
    setVerified(sessionID: string, verified: string): SessionState;
    setAcceptanceEvidence(sessionID: string, evidence: string): SessionState;
    setCandidateLevel(sessionID: string, level: SessionState["candidateLevel"]): SessionState;
    recordFailure(sessionID: string, reason: FailureReason, routeName?: string, summary?: string): SessionState;
    setFailureDetails(sessionID: string, reason: FailureReason, routeName?: string, summary?: string): SessionState;
    clearFailure(sessionID: string): SessionState;
    setLastTaskCategory(sessionID: string, category: string): SessionState;
    setLastDispatch(sessionID: string, routeName: string, subagentType: string, model?: string, variant?: string): SessionState;
    recordContradictionArtifacts(sessionID: string, artifacts: string[]): SessionState;
    recordDispatchOutcome(sessionID: string, outcome: DispatchOutcomeType): SessionState;
    setSubagentProfileOverride(sessionID: string, subagentType: string, profile: SubagentProfileOverride): SessionState;
    clearSubagentProfileOverride(sessionID: string, subagentType?: string): SessionState;
    triggerTaskFailover(sessionID: string): SessionState;
    consumeTaskFailover(sessionID: string): SessionState;
    clearTaskFailover(sessionID: string): SessionState;
    stageTodoRuntime(sessionID: string, toolCallID: string, todos: AegisTodoEntry[]): SessionState;
    commitTodoRuntime(sessionID: string, toolCallID: string, todos?: AegisTodoEntry[]): SessionState;
    recordActionSignature(sessionID: string, signature: string, limit?: number): SessionState;
    setLoopGuardBlock(sessionID: string, signature: string, reason: string): SessionState;
    clearLoopGuard(sessionID: string): SessionState;
    publishSharedMessage(sessionID: string, channelID: string, message: Omit<SharedChannelMessage, "seq" | "at">): SharedChannelMessage;
    readSharedMessages(sessionID: string, channelID?: string, sinceSeq?: number, limit?: number): SharedChannelMessage[];
    applyEvent(sessionID: string, event: SessionEvent): SessionState;
    setSolveLane(sessionID: string, lane: string | null): SessionState;
    setIntent(sessionID: string, intentType: IntentType): SessionState;
    setProblemStateClass(sessionID: string, cls: ProblemStateClass): SessionState;
    setManualVerifySuccess(sessionID: string, evidence: {
        verificationCommand: string;
        stdoutSummary: string;
        artifactPath?: string;
    }): SessionState;
    markModelUnhealthy(sessionID: string, modelId: string, reason: string): SessionState;
    markModelHealthy(sessionID: string, modelId: string): SessionState;
    toJSON(): Record<string, SessionState>;
    private computeCandidateHash;
    private load;
    private persist;
    private persistSync;
    private notify;
    private getOrCreateDispatchHealth;
}
