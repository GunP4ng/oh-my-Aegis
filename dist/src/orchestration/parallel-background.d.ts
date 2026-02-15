import type { OrchestratorConfig } from "../config/schema";
import { type ParallelTrack, type SessionClient } from "./parallel";
export declare class ParallelBackgroundManager {
    private readonly params;
    private sessionClient;
    private pollingInterval;
    private pollInFlight;
    private notifiedGroupKeys;
    constructor(params: {
        client: unknown;
        directory: string;
        config: OrchestratorConfig;
        pollIntervalMs?: number;
        trackTtlMs?: number;
    });
    bindSessionClient(sessionClient: SessionClient): void;
    ensurePolling(): void;
    stopPolling(): void;
    handleEvent(type: string, props: Record<string, unknown>): void;
    private markSessionDeleted;
    pollOnce(): Promise<void>;
    private hasAnyRunningTracks;
    private pruneStaleTracks;
    private pollOnceInner;
    private updateGroupFromIdle;
    private notifyGroupCompleted;
    private maybeShowToast;
    private maybePromptParent;
}
export declare function isTrackRunnable(track: ParallelTrack): boolean;
