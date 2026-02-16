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
    abort: (options: unknown) => Promise<any>;
    status: (options?: unknown) => Promise<any>;
    children: (options: unknown) => Promise<any>;
}
export declare function extractSessionClient(client: unknown): SessionClient | null;
export declare function dispatchParallel(sessionClient: SessionClient, parentSessionID: string, directory: string, plan: DispatchPlan, maxTracks: number, options?: {
    systemPrompt?: string;
    parallel?: OrchestratorConfig["parallel"];
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
}): Promise<CollectedResult[]>;
export declare function abortTrack(sessionClient: SessionClient, group: ParallelGroup, sessionID: string, directory: string): Promise<boolean>;
export declare function abortAllExcept(sessionClient: SessionClient, group: ParallelGroup, winnerSessionID: string, directory: string): Promise<number>;
export declare function abortAll(sessionClient: SessionClient, group: ParallelGroup, directory: string): Promise<number>;
export declare function groupSummary(group: ParallelGroup): Record<string, unknown>;
