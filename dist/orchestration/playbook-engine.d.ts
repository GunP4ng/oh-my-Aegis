import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import { type PlaybookRegistry, type PlaybookRule } from "./playbook-loader";
export type PlaybookContext = {
    mode: string;
    targetType: string;
    decoySuspect: boolean;
    interactiveEnabled: boolean;
    sequentialThinkingActive: boolean;
    sequentialThinkingToolName: string;
    contradictionPatchDumpDone: boolean;
    staleToolPatternLoops: number;
    noNewEvidenceLoops: number;
    contradictionPivotDebt: number;
};
export type PlaybookNextAction = {
    ruleId: string;
    tool?: string;
    route?: string;
};
export declare function matchesPlaybookRule(rule: PlaybookRule, context: PlaybookContext): boolean;
export declare function renderPlaybookTemplate(text: string, context: PlaybookContext): string;
export declare function buildPlaybookContext(state: SessionState, config: OrchestratorConfig): PlaybookContext;
export declare function findMatchingPlaybookRule(registry: PlaybookRegistry, context: PlaybookContext): PlaybookRule | null;
export declare function findPlaybookNextAction(state: SessionState, config: OrchestratorConfig): PlaybookNextAction | null;
export declare function findPlaybookNextRouteAction(state: SessionState, config: OrchestratorConfig): PlaybookNextAction | null;
