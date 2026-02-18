import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import type { DispatchPlan } from "./parallel";
export interface SubagentRequest {
    type: "explore" | "librarian";
    query: string;
    context?: string;
    background?: boolean;
}
export type SubagentDispatchConfigHint = Pick<OrchestratorConfig, "parallel">;
export declare function planExploreDispatch(state: SessionState, query: string, options?: {
    maxTracks?: number;
    focusAreas?: string[];
}): DispatchPlan;
export declare function planLibrarianDispatch(state: SessionState, query: string, options?: {
    searchTypes?: ("cve" | "writeup" | "docs" | "github")[];
    maxTracks?: number;
}): DispatchPlan;
export declare function detectSubagentType(query: string): "explore" | "librarian";
export declare function planMultiSubagentDispatch(state: SessionState, requests: SubagentRequest[]): DispatchPlan;
