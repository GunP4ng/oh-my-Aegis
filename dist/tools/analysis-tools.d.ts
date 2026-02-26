import type { ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
import type { NotesStore } from "../state/notes-store";
import type { SessionStore } from "../state/session-store";
export declare function createAnalysisTools(store: SessionStore, notesStore: NotesStore, config: OrchestratorConfig): Record<string, ToolDefinition>;
