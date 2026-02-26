export interface FlagCandidate {
    flag: string;
    format: string;
    source: string;
    confidence: "high" | "medium" | "low";
    timestamp: number;
}
export declare class FlagDetectorStore {
    private candidates;
    private customPattern;
    setCustomFlagPattern(pattern: string): void;
    private getPatterns;
    scanForFlags(text: string, source: string): FlagCandidate[];
    getCandidates(): FlagCandidate[];
    clearCandidates(): void;
    containsFlag(text: string): boolean;
}
export declare function setCustomFlagPattern(pattern: string): void;
export declare function scanForFlags(text: string, source: string): FlagCandidate[];
export declare function getCandidates(): FlagCandidate[];
export declare function clearCandidates(): void;
export declare function buildFlagAlert(flagCandidates: FlagCandidate[]): string;
export declare function containsFlag(text: string): boolean;
export interface DecoyCheckResult {
    isDecoySuspect: boolean;
    reason: string;
    decoyCandidates: FlagCandidate[];
}
/**
 * Check if detected flag candidates are likely decoys.
 * Triggers DECOY_SUSPECT when:
 *  1) Flag candidate found + oracle rejected it
 *  2) Flag content matches known decoy keywords
 *  3) Multiple candidates with low confidence
 */
export declare function checkForDecoy(candidates: FlagCandidate[], oraclePassed: boolean): DecoyCheckResult;
/**
 * Detect if a binary likely uses memfd/relocation tricks that make
 * standalone re-execution unreliable.
 */
export declare function isReplayUnsafe(stringsOutput?: string, readelfOutput?: string): {
    unsafe: boolean;
    signals: string[];
};
