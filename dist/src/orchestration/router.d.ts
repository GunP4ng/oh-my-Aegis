import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
export interface RouteDecision {
    primary: string;
    reason: string;
    followups?: string[];
}
export interface FailoverConfig {
    signatures: string[];
    map: {
        explore: string;
        librarian: string;
        oracle: string;
    };
}
export declare function isStuck(state: SessionState, config?: OrchestratorConfig): boolean;
export declare function route(state: SessionState, config?: OrchestratorConfig): RouteDecision;
export declare function resolveFailoverAgent(originalAgent: string, errorText: string, config: FailoverConfig): string | null;
