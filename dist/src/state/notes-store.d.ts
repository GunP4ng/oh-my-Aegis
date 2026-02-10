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
export declare class NotesStore {
    private readonly rootDir;
    private readonly archiveDir;
    private readonly budgets;
    constructor(baseDirectory: string, markdownBudget: OrchestratorConfig["markdown_budget"]);
    getRootDirectory(): string;
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
    private writeContextPack;
    private appendWorklog;
    private appendEvidence;
    private appendWithBudget;
    private rotateIfNeeded;
    private inspectFile;
    private now;
    private archiveStamp;
}
