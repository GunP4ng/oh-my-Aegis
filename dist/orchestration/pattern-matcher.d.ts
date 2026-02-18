import type { TargetType } from "../state/types";
export interface PatternMatch {
    patternId: string;
    patternName: string;
    confidence: "high" | "medium" | "low";
    targetType: TargetType;
    description: string;
    suggestedApproach: string;
    suggestedTemplate?: string;
    keywords: string[];
}
/**
 * Match challenge or analysis text against known CTF patterns.
 */
export declare function matchPatterns(text: string, targetType?: TargetType): PatternMatch[];
/**
 * Get a known pattern by ID.
 */
export declare function getPattern(patternId: string): PatternMatch | null;
/**
 * List all known patterns, optionally filtering by target type.
 */
export declare function listPatterns(targetType?: TargetType): PatternMatch[];
/**
 * Build a compact prompt summary from matched patterns.
 */
export declare function buildPatternSummary(matches: PatternMatch[]): string;
