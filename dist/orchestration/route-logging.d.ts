import type { OrchestratorConfig } from "../config/schema";
import type { RouteDecision } from "../types/route-decision";
import type { SessionState } from "../state/types";
export declare function createRouteLogger(deps: {
    getRootDirectory: () => string;
    isNotesReady: () => boolean;
    appendRecord: (record: Record<string, unknown>) => void;
    onError: (error: unknown) => void;
    isStuck: (state: SessionState, config: OrchestratorConfig) => boolean;
    config: OrchestratorConfig;
}): {
    logRouteDecision: (sessionID: string, state: SessionState, decision: RouteDecision, source: string) => void;
};
