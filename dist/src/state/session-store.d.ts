import { type DispatchOutcomeType, type FailureReason, type Mode, type SessionEvent, type SessionState, type TargetType } from "./types";
export type StoreChangeReason = "set_mode" | "set_ultrawork_enabled" | "set_auto_loop_enabled" | "record_auto_loop_prompt" | "set_target_type" | "set_hypothesis" | "set_alternatives" | "set_candidate" | "set_verified" | "record_failure" | "set_failure_details" | "clear_failure" | "set_last_task_category" | "set_last_dispatch" | "record_dispatch_outcome" | "trigger_task_failover" | "consume_task_failover" | "clear_task_failover" | "mark_model_unhealthy" | "mark_model_healthy" | SessionEvent;
export interface StoreChangeEvent {
    sessionID: string;
    state: SessionState;
    reason: StoreChangeReason;
}
export type StoreObserver = (event: StoreChangeEvent) => void;
export declare class SessionStore {
    private readonly filePath;
    private readonly stateMap;
    private readonly observer?;
    private readonly defaultMode;
    private persistenceDegraded;
    private observerDegraded;
    constructor(baseDirectory: string, observer?: StoreObserver, defaultMode?: Mode);
    get(sessionID: string): SessionState;
    setMode(sessionID: string, mode: Mode): SessionState;
    setUltraworkEnabled(sessionID: string, enabled: boolean): SessionState;
    setAutoLoopEnabled(sessionID: string, enabled: boolean): SessionState;
    recordAutoLoopPrompt(sessionID: string): SessionState;
    setTargetType(sessionID: string, targetType: TargetType): SessionState;
    setHypothesis(sessionID: string, hypothesis: string): SessionState;
    setAlternatives(sessionID: string, alternatives: string[]): SessionState;
    setCandidate(sessionID: string, candidate: string): SessionState;
    setVerified(sessionID: string, verified: string): SessionState;
    recordFailure(sessionID: string, reason: FailureReason, routeName?: string, summary?: string): SessionState;
    setFailureDetails(sessionID: string, reason: FailureReason, routeName?: string, summary?: string): SessionState;
    clearFailure(sessionID: string): SessionState;
    setLastTaskCategory(sessionID: string, category: string): SessionState;
    setLastDispatch(sessionID: string, routeName: string, subagentType: string): SessionState;
    recordDispatchOutcome(sessionID: string, outcome: DispatchOutcomeType): SessionState;
    triggerTaskFailover(sessionID: string): SessionState;
    consumeTaskFailover(sessionID: string): SessionState;
    clearTaskFailover(sessionID: string): SessionState;
    applyEvent(sessionID: string, event: SessionEvent): SessionState;
    markModelUnhealthy(sessionID: string, modelId: string, reason: string): SessionState;
    markModelHealthy(sessionID: string, modelId: string): SessionState;
    toJSON(): Record<string, SessionState>;
    private load;
    private persist;
    private notify;
    private getOrCreateDispatchHealth;
}
