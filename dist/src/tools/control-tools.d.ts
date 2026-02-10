import { type ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
import type { NotesStore } from "../state/notes-store";
import { type SessionStore } from "../state/session-store";
export declare function createControlTools(store: SessionStore, notesStore: NotesStore, config: OrchestratorConfig, projectDir: string): Record<string, ToolDefinition>;
