import type { OrchestratorConfig } from "../config/schema";
import type { NotesStore } from "../state/notes-store";
import type { SessionStore } from "../state/session-store";
export declare function extractContextUsageRatio(props: Record<string, unknown>): number | null;
export declare function createContextWindowRecoveryManager(params: {
    client: unknown;
    directory: string;
    notesStore: NotesStore;
    config: OrchestratorConfig;
    store: SessionStore;
    getDefaultModel?: (sessionID: string) => string | undefined;
}): {
    handleEvent: (type: string, props: Record<string, unknown>) => Promise<void>;
    handleContextFailureText: (sessionID: string, text: string) => Promise<void>;
};
