import type { OrchestratorConfig } from "../config/schema";
import type { Mode } from "../state/types";
export interface PolicyDecision {
    allow: boolean;
    reason?: string;
    sanitizedCommand?: string;
}
export declare function evaluateBashCommand(command: string, config: OrchestratorConfig, mode: Mode, options?: {
    scopeConfirmed?: boolean;
}): PolicyDecision;
export declare function extractBashCommand(metadata: unknown): string;
