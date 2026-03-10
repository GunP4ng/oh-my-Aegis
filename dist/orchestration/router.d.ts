import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import type { RouteDecision } from "../types/route-decision";
import { isStuck } from "./stuck";
export type { RouteDecision };
export { isStuck };
export interface FailoverConfig {
    signatures: string[];
    map: {
        explore: string;
        librarian: string;
        oracle: string;
    };
}
export declare function buildWorkPackage(state: SessionState): string;
export declare function route(state: SessionState, config?: OrchestratorConfig): RouteDecision;
export declare function resolveFailoverAgent(originalAgent: string, errorText: string, config: FailoverConfig): string | null;
