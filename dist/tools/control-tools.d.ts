import { type ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
import type { ParallelBackgroundManager } from "../orchestration/parallel-background";
import type { NotesStore } from "../state/notes-store";
import { type SessionStore } from "../state/session-store";
export declare function createControlTools(store: SessionStore, notesStore: NotesStore, config: OrchestratorConfig, projectDir: string, client: unknown, parallelBackgroundManager: ParallelBackgroundManager): Record<string, ToolDefinition>;
