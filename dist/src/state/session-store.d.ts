import { type DispatchOutcomeType, type FailureReason, type Mode, type SessionEvent, type SessionState, type TargetType } from "./types";
export type StoreChangeReason = "set_mode" | "set_target_type" | "set_hypothesis" | "set_alternatives" | "set_candidate" | "set_verified" | "record_failure" | "clear_failure" | "set_last_task_category" | "set_last_dispatch" | "record_dispatch_outcome" | "trigger_task_failover" | "consume_task_failover" | "clear_task_failover" | SessionEvent;
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
    setTargetType(sessionID: string, targetType: TargetType): SessionState;
    setHypothesis(sessionID: string, hypothesis: string): SessionState;
    setAlternatives(sessionID: string, alternatives: string[]): SessionState;
    setCandidate(sessionID: string, candidate: string): SessionState;
    setVerified(sessionID: string, verified: string): SessionState;
    recordFailure(sessionID: string, reason: FailureReason, routeName?: string, summary?: string): SessionState;
    clearFailure(sessionID: string): SessionState;
    setLastTaskCategory(sessionID: string, category: string): SessionState;
    setLastDispatch(sessionID: string, routeName: string, subagentType: string): SessionState;
    recordDispatchOutcome(sessionID: string, outcome: DispatchOutcomeType): SessionState;
    triggerTaskFailover(sessionID: string): SessionState;
    consumeTaskFailover(sessionID: string): SessionState;
    clearTaskFailover(sessionID: string): SessionState;
    applyEvent(sessionID: string, event: SessionEvent): SessionState;
    toJSON(): Record<string, SessionState>;
    private load;
    private persist;
    private notify;
    private getOrCreateDispatchHealth;
}
