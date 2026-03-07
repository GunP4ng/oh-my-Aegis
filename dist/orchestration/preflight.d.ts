import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
export declare const ROUTE_CAPABILITIES: Record<string, string[]>;
export interface PreflightResult {
    ok: boolean;
    failedCapability?: string;
    fallbackRoute?: string;
}
export declare function checkRoutePreflight(route: string, state: SessionState, config: OrchestratorConfig, resolvedModel?: string): PreflightResult;
