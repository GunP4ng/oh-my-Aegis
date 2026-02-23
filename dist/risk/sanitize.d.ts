import type { FailureReason } from "../state/types";
export declare function normalizeWhitespace(input: string): string;
export declare function stripAnsi(input: string): string;
export declare function sanitizeCommand(input: string): string;
export declare function isLikelyTimeout(output: string): boolean;
export declare function isContextLengthFailure(output: string): boolean;
export declare function isTokenOrQuotaFailure(output: string): boolean;
export declare function isRetryableTaskFailure(output: string): boolean;
export declare function classifyFailureReason(output: string): FailureReason | null;
export declare function detectInjectionIndicators(text: string): string[];
export declare function isVerificationSourceRelevant(toolName: string, title: string | null | undefined, options: {
    verifierToolNames: string[];
    verifierTitleMarkers: string[];
}): boolean;
export declare function isVerifySuccess(output: string): boolean;
export declare function isVerifyFailure(output: string): boolean;
export declare function detectInteractiveCommand(command: string): {
    id: string;
    reason: string;
} | null;
/**
 * Thinking Block Validator.
 * Detects malformed thinking block structures in model output that would
 * cause downstream parsing errors.
 *
 * Returns the sanitized text if a fix was applied, or null if no issue found.
 */
export declare function sanitizeThinkingBlocks(text: string): string | null;
