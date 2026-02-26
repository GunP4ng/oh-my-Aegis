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
export interface RevLoaderVmIndicator {
    hasAbnormalRela: boolean;
    hasCustomSections: boolean;
    hasEmbeddedElf: boolean;
    signals: string[];
}
/**
 * Detect REV Loader/VM characteristics from readelf/objdump output.
 * Triggers when: .rela.* non-standard sections, embedded ELFs, or custom section names found.
 */
export declare function detectRevLoaderVm(readelfSections?: string, readelfRelocs?: string, stringsOutput?: string): RevLoaderVmIndicator;
/**
 * Check if binary shows REV Loader/VM pattern that requires
 * reloc patch-and-dump over static decryption.
 */
export declare function shouldForceRelocPatchDump(indicator: RevLoaderVmIndicator): boolean;
/**
 * Run full triage pipeline for a single file.
 */
export declare function triageFile(filePath: string, fileOutput?: string): TriageResult;
/**
 * Build prompt injection text from triage results.
 */
export declare function buildTriageSummary(results: TriageResult[]): string;
