import type { ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
import type { ParallelBackgroundManager } from "../orchestration/parallel-background";
import type { SessionStore } from "../state/session-store";
export declare function createParallelTools(store: SessionStore, config: OrchestratorConfig, projectDir: string, client: unknown, parallelBackgroundManager: ParallelBackgroundManager): Record<string, ToolDefinition>;
