import type { OrchestratorConfig } from "../config/schema";
import type { RouteDecision } from "../orchestration/router";
import type { StoreChangeReason } from "./session-store";
import type { SessionState } from "./types";
export interface BudgetIssue {
    fileName: string;
    lineCount: number;
    byteCount: number;
    maxLines: number;
    maxBytes: number;
}
export interface NotesStoreFlushMetric {
    trigger: "immediate" | "timer" | "manual";
    durationMs: number;
    filesTouched: number;
    appendBytes: number;
    replaceBytes: number;
    asyncPersistence: boolean;
    failed: boolean;
    reason: string;
}
export interface NotesStoreOptions {
    asyncPersistence?: boolean;
    flushDelayMs?: number;
    onFlush?: (metric: NotesStoreFlushMetric) => void;
    /** 상태 변경 시 플로우 렌더러에 알리는 콜백 */
    onFlowRender?: (sessionID: string, state: import("./types").SessionState, decision: import("../orchestration/router").RouteDecision) => void;
}
export declare class NotesStore {
    private readonly rootDir;
    private readonly archiveDir;
    private readonly asyncPersistence;
    private readonly onFlush?;
    private readonly budgets;
    private persistenceDegraded;
    private readonly pendingByFile;
    private readonly onFlowRender?;
    private readonly flushFlusher;
    constructor(baseDirectory: string, markdownBudget: OrchestratorConfig["markdown_budget"], rootDirName?: string, options?: NotesStoreOptions);
    getRootDirectory(): string;
    flushNow(): void;
    checkWritable(): {
        ok: boolean;
        issues: string[];
    };
    ensureFiles(): void;
    recordChange(sessionID: string, state: SessionState, reason: StoreChangeReason, decision: RouteDecision): void;
    recordScan(summary: string): void;
    recordInjectionAttempt(source: string, indicators: string[], snippet: string): void;
    checkBudgets(): BudgetIssue[];
    compactNow(): string[];
    private ensureFile;
    private writeState;
    private buildStateContent;
    private writeContextPack;
    private buildContextPackContent;
    private appendWorklog;
    private buildWorklogBlock;
    private appendEvidence;
    private buildEvidenceBlock;
    private appendWithBudget;
    private queueReplace;
    private queueAppend;
    private flushPendingSync;
    private rotateIfNeeded;
    private inspectFile;
    private now;
    private archiveStamp;
}
