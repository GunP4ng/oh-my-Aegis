import type { NotesStore } from "../state/notes-store";
import type { OrchestratorConfig } from "./schema";
export interface ReadinessReport {
    ok: boolean;
    notesWritable: boolean;
    checkedConfigPath: string | null;
    scopeDoc: {
        found: boolean;
        path: string | null;
        warnings: string[];
        allowedHostsCount: number;
        deniedHostsCount: number;
        blackoutWindowsCount: number;
    };
    requiredSubagents: string[];
    missingSubagents: string[];
    requiredProviders: string[];
    missingProviders: string[];
    requiredMcps: string[];
    missingMcps: string[];
    missingAuthPlugins: string[];
    coverageByTarget: Record<string, {
        requiredSubagents: string[];
        missingSubagents: string[];
    }>;
    issues: string[];
    warnings: string[];
}
export declare function buildReadinessReport(projectDir: string, notesStore: NotesStore, config: OrchestratorConfig): ReadinessReport;
