import type { OrchestratorConfig } from "../config/schema";
import type { NotesStore } from "../state/notes-store";
import type { SessionStore } from "../state/session-store";
export type SessionRecoveryErrorType = "tool_result_missing" | "thinking_block_order" | "thinking_disabled_violation" | "assistant_prefill_unsupported";
export declare function detectSessionRecoveryErrorType(error: unknown): SessionRecoveryErrorType | null;
export declare function createSessionRecoveryManager(params: {
    client: unknown;
    directory: string;
    notesStore: NotesStore;
    config: OrchestratorConfig;
    store: SessionStore;
}): {
    isRecoverableError: (error: unknown) => boolean;
    handleEvent: (type: string, props: Record<string, unknown>) => Promise<void>;
};
