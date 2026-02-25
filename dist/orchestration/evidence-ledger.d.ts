export type EvidenceType = "string_pattern" | "static_reverse" | "dynamic_memory" | "behavioral_runtime" | "acceptance_oracle";
export type EvidenceLevel = "L0" | "L1" | "L2" | "L3";
export interface EvidenceEntry {
    at: string;
    sessionID: string;
    event: string;
    evidenceType: EvidenceType;
    confidence: number;
    summary: string;
    source: string;
}
export declare function clampConfidence(value: number): number;
export declare function scoreEvidence(entries: EvidenceEntry[]): {
    score: number;
    level: EvidenceLevel;
    hasAcceptance: boolean;
};
export declare function appendEvidenceLedger(rootDir: string, entry: EvidenceEntry): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
