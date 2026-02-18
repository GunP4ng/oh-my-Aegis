import type { TargetType } from "../state/types";
export interface ToolCommand {
    tool: string;
    command: string;
    purpose: string;
    outputParser?: string;
}
export interface ChecksecResult {
    relro: "Full" | "Partial" | "No";
    canary: boolean;
    nx: boolean;
    pie: boolean;
    rpath: boolean;
    runpath: boolean;
    fortify: boolean;
    stripped: boolean;
}
export interface ToolResult {
    tool: string;
    success: boolean;
    rawOutput: string;
    parsed: Record<string, unknown>;
    summary: string;
}
/**
 * Generate a checksec command for hardening inspection.
 */
export declare function checksecCommand(binaryPath: string): ToolCommand;
/**
 * Parse checksec output into a structured hardening report.
 */
export declare function parseChecksecOutput(output: string): ChecksecResult | null;
/**
 * Generate a ROPgadget command with optional depth and filter.
 */
export declare function ropgadgetCommand(binaryPath: string, options?: {
    depth?: number;
    filter?: string;
}): ToolCommand;
/**
 * Generate a one_gadget command against a target libc.
 */
export declare function oneGadgetCommand(libcPath: string): ToolCommand;
/**
 * Generate a binwalk command and optional extraction.
 */
export declare function binwalkCommand(filePath: string, extract?: boolean): ToolCommand;
/**
 * Generate an exiftool command for metadata extraction.
 */
export declare function exiftoolCommand(filePath: string): ToolCommand;
/**
 * Generate a nuclei command with bounded rate-limit for safer bounty workflows.
 */
export declare function nucleiCommand(target: string, options?: {
    templates?: string;
    rateLimit?: number;
    severity?: string;
}): ToolCommand;
/**
 * Generate an RsaCtfTool command from key components or a public key file.
 */
export declare function rsactftoolCommand(options: {
    n?: string;
    e?: string;
    c?: string;
    publicKey?: string;
}): ToolCommand;
/**
 * Build a minimal Python z3 solver template for provided constraints.
 */
export declare function z3SolverTemplate(constraints: string[]): string;
/**
 * Generate patchelf command sequence to align binary libc/ld linkage.
 */
export declare function patchelfCommand(binaryPath: string, libcPath: string, ldPath?: string): ToolCommand;
/**
 * Build compact prompt-ready summary text from tool results.
 */
export declare function buildToolSummary(results: ToolResult[]): string;
/**
 * Return recommended starter tools for a target type.
 */
export declare function recommendedTools(targetType: TargetType): ToolCommand[];
