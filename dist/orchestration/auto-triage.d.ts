import type { TargetType } from "../state/types";
export interface TriageCommand {
    tool: string;
    command: string;
    purpose: string;
    phase: number;
}
export interface TriageResult {
    filePath: string;
    detectedType: string;
    suggestedTarget: TargetType;
    commands: TriageCommand[];
    summary: string;
}
/**
 * Detect file type from extension and optional `file` command output.
 */
export declare function detectFileType(filePath: string, fileOutput?: string): string;
/**
 * Map detected file type to suggested orchestration target.
 */
export declare function suggestTarget(detectedType: string): TargetType;
/**
 * Generate triage commands for a file based on detected type.
 */
export declare function generateTriageCommands(filePath: string, detectedType: string): TriageCommand[];
/**
 * Run full triage pipeline for a single file.
 */
export declare function triageFile(filePath: string, fileOutput?: string): TriageResult;
/**
 * Build prompt injection text from triage results.
 */
export declare function buildTriageSummary(results: TriageResult[]): string;
