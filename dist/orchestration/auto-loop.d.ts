import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import type { RouteDecision } from "../types/route-decision";
type AutoLoopStore = {
    get: (sessionID: string) => SessionState;
    setAutoLoopEnabled: (sessionID: string, enabled: boolean) => SessionState;
    recordAutoLoopPrompt: (sessionID: string) => SessionState;
};
type ToastParams = {
    sessionID: string;
    key: string;
    title: string;
    message: string;
    variant: "info" | "warning" | "error" | "success";
    durationMs?: number;
};
export declare function createAutoLoopRunner(params: {
    config: OrchestratorConfig;
    store: AutoLoopStore;
    client: unknown;
    directory: string;
    note: (label: string, message: string) => void;
    noteHookError: (label: string, error: unknown) => void;
    maybeShowToast: (params: ToastParams) => Promise<void>;
    logRouteDecision: (sessionID: string, state: SessionState, decision: RouteDecision, source: string) => void;
    route: (state: SessionState, config: OrchestratorConfig) => RouteDecision;
    buildWorkPackage: (state: SessionState) => string;
    consumeSearchModeGuidance: (sessionID: string) => boolean;
}): (sessionID: string, trigger: string) => Promise<void>;
export {};
