export interface FlagCandidate {
    flag: string;
    format: string;
    source: string;
    confidence: "high" | "medium" | "low";
    timestamp: number;
}
/**
 * Set a custom flag regex for the current session.
 *
 * Passing an empty string clears the custom pattern.
 */
export declare function setCustomFlagPattern(pattern: string): void;
/**
 * Scan text for known or custom flag patterns.
 */
export declare function scanForFlags(text: string, source: string): FlagCandidate[];
/**
 * Get all accumulated flag candidates.
 */
export declare function getCandidates(): FlagCandidate[];
/**
 * Clear all accumulated flag candidates.
 */
export declare function clearCandidates(): void;
/**
 * Build an alert block for prompt injection when candidates are found.
 */
export declare function buildFlagAlert(flagCandidates: FlagCandidate[]): string;
/**
 * Fast boolean check for likely flag patterns.
 */
export declare function containsFlag(text: string): boolean;
