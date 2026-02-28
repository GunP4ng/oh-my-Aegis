/**
 * Parallel CTF orchestration module.
 *
 * Uses OpenCode SDK session primitives (session.create, session.promptAsync,
 * session.messages, session.abort) to dispatch multiple child sessions in
 * parallel and merge results.
 */
import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
export interface ParallelTrack {
    sessionID: string;
    purpose: string;
    agent: string;
    provider: string;
    prompt: string;
    status: "pending" | "running" | "completed" | "aborted" | "failed";
    createdAt: number;
    completedAt: number;
    result: string;
    isWinner: boolean;
    /** 현재 수행 중인 작업 한줄 설명 (tool.execute.after 훅에서 갱신) */
    lastActivity: string;
}
export interface ParallelGroup {
    parentSessionID: string;
    label: string;
    tracks: ParallelTrack[];
    queue: DispatchPlan["tracks"];
    parallel: {
        capDefault: number;
        providerCaps: Record<string, number>;
        queueEnabled: boolean;
    };
    createdAt: number;
    completedAt: number;
    winnerSessionID: string;
    winnerRationale?: string;
    maxTracks: number;
}
export interface DispatchPlan {
    tracks: Array<{
        purpose: string;
        agent: string;
        prompt: string;
    }>;
    label: string;
}
export interface ParallelStructuredResult {
    findings: unknown[];
    evidence: unknown[];
    next_todo: string[];
}
export interface CollectResultsOutput {
    results: CollectedResult[];
    merged: ParallelStructuredResult;
    quarantinedSessionIDs: string[];
}
export declare function configureParallelPersistence(projectDir: string, rootDirName?: string): void;
export declare function persistParallelGroups(): void;
export declare function persistParallelGroupsDeferred(): void;
export declare function getGroups(parentSessionID: string): ParallelGroup[];
export declare function getActiveGroup(parentSessionID: string): ParallelGroup | null;
export declare function getAllGroups(): Map<string, ParallelGroup[]>;
export declare function planScanDispatch(state: SessionState, config: OrchestratorConfig, challengeDescription: string): DispatchPlan;
export declare function planHypothesisDispatch(state: SessionState, config: OrchestratorConfig, hypotheses: Array<{
    hypothesis: string;
    disconfirmTest: string;
}>): DispatchPlan;
export declare function planDeepWorkerDispatch(state: SessionState, config: OrchestratorConfig, goal: string): DispatchPlan;
export interface SessionClient {
    create: (options: unknown) => Promise<any>;
    promptAsync: (options: unknown) => Promise<any>;
    messages: (options: unknown) => Promise<any>;
    fork?: (options: unknown) => Promise<any>;
    abort: (options: unknown) => Promise<any>;
    status: (options?: unknown) => Promise<any>;
    children: (options: unknown) => Promise<any>;
}
export declare function extractSessionClient(client: unknown): SessionClient | null;
export declare function dispatchParallel(sessionClient: SessionClient, parentSessionID: string, directory: string, plan: DispatchPlan, maxTracks: number, options?: {
    systemPrompt?: string;
    parallel?: OrchestratorConfig["parallel"];
    state?: SessionState;
}): Promise<ParallelGroup>;
export declare function dispatchQueuedTracks(sessionClient: SessionClient, group: ParallelGroup, directory: string, systemPrompt?: string): Promise<number>;
export interface CollectedResult {
    sessionID: string;
    purpose: string;
    agent: string;
    status: string;
    messages: string[];
    lastAssistantMessage: string;
}
export declare function collectResults(sessionClient: SessionClient, group: ParallelGroup, directory: string, messageLimit?: number, options?: {
    idleSessionIDs?: Set<string>;
}): Promise<CollectResultsOutput>;
export declare function abortTrack(sessionClient: SessionClient, group: ParallelGroup, sessionID: string, directory: string): Promise<boolean>;
export declare function abortAllExcept(sessionClient: SessionClient, group: ParallelGroup, winnerSessionID: string, directory: string, winnerRationale?: string): Promise<number>;
export declare function abortAll(sessionClient: SessionClient, group: ParallelGroup, directory: string): Promise<number>;
export declare function groupSummary(group: ParallelGroup): Record<string, unknown>;
export interface FlowTrackSnapshot {
    sessionID: string;
    agent: string;
    purpose: string;
    lastActivity: string;
    status: ParallelTrack["status"];
    isWinner: boolean;
    durationMs: number;
}
export interface FlowGroupSnapshot {
    label: string;
    completedCount: number;
    totalCount: number;
    winnerSessionID: string;
    tracks: FlowTrackSnapshot[];
}
/** tmux 렌더러에서 읽는 현재 병렬 그룹 스냅샷 */
export declare function getParallelGroupSnapshots(parentSessionID: string): FlowGroupSnapshot[];
/** tool.execute.after 훅에서 특정 트랙의 현재 작업 설명을 갱신 */
export declare function updateTrackActivity(childSessionID: string, activity: string): void;
