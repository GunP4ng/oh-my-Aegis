import type { ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
import type { ParallelBackgroundManager } from "../orchestration/parallel-background";
import type { SessionStore } from "../state/session-store";
export interface StableToolArtifacts {
    refs?: string[];
    paths?: string[];
    [key: string]: unknown;
}
export interface StableToolResponse {
    ok: boolean;
    reason: string;
    sessionID: string;
    artifacts?: StableToolArtifacts;
    [key: string]: unknown;
}
export declare function stableToolResponse(payload: StableToolResponse): string;
export declare function createParallelTools(store: SessionStore, config: OrchestratorConfig, projectDir: string, client: unknown, parallelBackgroundManager: ParallelBackgroundManager): Record<string, ToolDefinition>;
