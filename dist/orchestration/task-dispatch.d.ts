import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
export interface TaskDispatchDecision {
    subagent_type?: string;
    model?: string;
    reason: string;
}
export declare const NON_OVERRIDABLE_ROUTE_AGENTS: Set<string>;
export declare function isNonOverridableSubagent(name: string): boolean;
export declare function requiredDispatchSubagents(config?: OrchestratorConfig): string[];
export declare function decideAutoDispatch(routePrimary: string, state: SessionState, maxFailoverRetries: number, config?: OrchestratorConfig): TaskDispatchDecision;
export interface NoteInstruction {
    key: string;
    message: string;
}
export type StoreInstruction = {
    type: "setLastTaskCategory";
    value: string;
} | {
    type: "setLastDispatch";
    route: string;
    subagent: string;
    model?: string;
    variant?: string;
} | {
    type: "consumeTaskFailover";
} | {
    type: "setThinkMode";
    value: "none";
} | {
    type: "appendRecentEvent";
    value: string;
    cap: number;
};
export interface TaskPromptContextInput {
    args: Record<string, unknown>;
    state: SessionState;
    godModeEnabled: boolean;
}
export interface TaskPromptContextResult {
    args: Record<string, unknown>;
}
export declare function shapeTaskPromptContext(input: TaskPromptContextInput): TaskPromptContextResult;
export interface TaskDispatchShapingInput {
    args: Record<string, unknown>;
    state: SessionState;
    config: OrchestratorConfig;
    callerAgent: string;
    sessionID: string;
    decisionPrimary: string;
    searchModeRequested: boolean;
    searchModeGuidancePending: boolean;
    hasActiveParallelGroup: boolean;
    availableSkills: Set<string>;
    isWindows: boolean;
    resolveSharedChannelPrompt: (subagentType: string) => string;
}
export interface TaskDispatchShapingResult {
    args: Record<string, unknown>;
    notes: NoteInstruction[];
    storeInstructions: StoreInstruction[];
    clearSearchModeGuidancePending: boolean;
}
export declare function shapeTaskDispatch(input: TaskDispatchShapingInput): TaskDispatchShapingResult;
