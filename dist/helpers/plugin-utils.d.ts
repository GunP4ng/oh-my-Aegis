import type { TargetType } from "../state/types";
export declare function detectDockerParityRequirement(workdir: string): {
    required: boolean;
    reason: string;
};
export declare class AegisPolicyDenyError extends Error {
    constructor(message: string);
}
export declare function escapeRegExp(value: string): string;
export declare function normalizePathForMatch(path: string): string;
export declare function globToRegExp(glob: string): RegExp;
export declare function normalizeToolName(value: string): string;
export declare function maskSensitiveToolOutput(text: string): string;
export declare function isPathInsideRoot(path: string, root: string): boolean;
export declare function truncateWithHeadTail(text: string, headChars: number, tailChars: number): string;
export declare function extractArtifactPathHints(text: string): string[];
export declare function isAegisManagerDelegationTool(toolName: string): boolean;
export declare function inProgressTodoCount(args: unknown): number;
export declare function todoStatusCounts(todos: unknown[]): {
    pending: number;
    inProgress: number;
    completed: number;
    open: number;
};
export declare const SYNTHETIC_START_TODO = "Start the next concrete TODO step.";
export declare const SYNTHETIC_CONTINUE_TODO = "Continue with the next TODO after updating the completed step.";
export declare const SYNTHETIC_BREAKDOWN_PREFIX = "Break down remaining work into smaller TODO #";
export declare function todoContent(todo: unknown): string;
export declare function isSyntheticTodoContent(content: string): boolean;
export declare function textFromParts(parts: unknown[]): string;
export declare function textFromUnknown(value: unknown): string;
export declare function detectTargetType(text: string): TargetType | null;
