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
export declare function isLowConfidenceCandidate(candidate: string): boolean;
export declare function extractVerifierEvidence(output: string, candidate?: string): string | null;
export declare function hasVerifierEvidence(output: string, candidate?: string): boolean;
export declare function hasVerifyOracleSuccess(output: string): boolean;
export declare function hasExitCodeZeroEvidence(output: string): boolean;
export declare function hasRuntimeEvidence(output: string): boolean;
export declare function hasAcceptanceEvidence(output: string): boolean;
export interface RevRiskAssessment {
    vmSuspected: boolean;
    score: number;
    signals: string[];
    staticTrust: number;
}
export declare function assessRevVmRisk(output: string): RevRiskAssessment;
export interface DomainRiskAssessment {
    score: number;
    signals: string[];
    highRisk: boolean;
}
export declare function assessWebRisk(output: string): DomainRiskAssessment;
export declare function assessWeb3Risk(output: string): DomainRiskAssessment;
export declare function assessCryptoRisk(output: string): DomainRiskAssessment;
export declare function assessForensicsRisk(output: string): DomainRiskAssessment;
export declare function assessMiscRisk(output: string): DomainRiskAssessment;
export declare function assessDomainRisk(targetType: string, output: string): DomainRiskAssessment | null;
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
