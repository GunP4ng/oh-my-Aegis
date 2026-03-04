export type PatchOperation = "add" | "modify" | "delete" | "rename" | "binary";
export interface PatchBudgets {
    max_files: number;
    max_loc: number;
}
export interface PatchPolicy {
    budgets: PatchBudgets;
    allowed_operations: readonly PatchOperation[];
    allow_paths: readonly string[];
    deny_paths: readonly string[];
}
export interface ParsedPatchFile {
    oldPath: string | null;
    newPath: string | null;
    normalizedPath: string;
    operation: PatchOperation;
    added: number;
    removed: number;
    binary: boolean;
}
export interface ParsedUnifiedDiff {
    files: ParsedPatchFile[];
    fileCount: number;
    totalAdded: number;
    totalRemoved: number;
    totalLoc: number;
}
export type PatchParseResult = {
    ok: true;
    value: ParsedUnifiedDiff;
} | {
    ok: false;
    reason: string;
};
export interface PatchPolicyDecision {
    allow: boolean;
    reasons: string[];
    normalizedPaths: string[];
    operations: PatchOperation[];
    stats: {
        files: number;
        total_loc: number;
        added: number;
        removed: number;
    };
}
export declare function normalizePatchPath(rawPath: string): {
    ok: true;
    path: string;
} | {
    ok: false;
    reason: string;
};
export declare function parseUnifiedDiffStrict(diffText: string): PatchParseResult;
export declare function validateParsedPatchAgainstPolicy(parsed: ParsedUnifiedDiff, policy: PatchPolicy): PatchPolicyDecision;
export declare function validateUnifiedDiffAgainstPolicy(diffText: string, policy: PatchPolicy): {
    ok: true;
    parsed: ParsedUnifiedDiff;
    decision: PatchPolicyDecision;
} | {
    ok: false;
    reason: string;
    decision?: PatchPolicyDecision;
};
