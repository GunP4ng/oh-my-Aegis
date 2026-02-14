import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
export interface TaskDispatchDecision {
    subagent_type?: string;
    reason: string;
}
export declare const NON_OVERRIDABLE_ROUTE_AGENTS: Set<string>;
export declare function isNonOverridableSubagent(name: string): boolean;
export declare function requiredDispatchSubagents(config?: OrchestratorConfig): string[];
export declare function decideAutoDispatch(routePrimary: string, state: SessionState, maxFailoverRetries: number, config?: OrchestratorConfig): TaskDispatchDecision;
