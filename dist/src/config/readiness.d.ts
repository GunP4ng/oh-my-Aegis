import type { NotesStore } from "../state/notes-store";
import type { OrchestratorConfig } from "./schema";
export interface ReadinessReport {
    ok: boolean;
    notesWritable: boolean;
    checkedConfigPath: string | null;
    requiredSubagents: string[];
    missingSubagents: string[];
    requiredMcps: string[];
    missingMcps: string[];
    coverageByTarget: Record<string, {
        requiredSubagents: string[];
        missingSubagents: string[];
    }>;
    issues: string[];
    warnings: string[];
}
export declare function buildReadinessReport(projectDir: string, notesStore: NotesStore, config: OrchestratorConfig): ReadinessReport;
