import type { OrchestratorConfig } from "../config/schema";
import type { Mode } from "../state/types";
import type { BountyScopePolicy } from "../bounty/scope-policy";
export interface PolicyDecision {
    allow: boolean;
    reason?: string;
    sanitizedCommand?: string;
    denyLevel?: "hard" | "soft";
}
export declare function evaluateBashCommand(command: string, config: OrchestratorConfig, mode: Mode, options?: {
    scopeConfirmed?: boolean;
    scopePolicy?: BountyScopePolicy | null;
    now?: Date;
}): PolicyDecision;
export declare function extractBashCommand(metadata: unknown): string;
