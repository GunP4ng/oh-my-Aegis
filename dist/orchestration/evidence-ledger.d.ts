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
export interface OracleProgress {
    passCount: number;
    failIndex: number;
    totalTests: number;
    passRate: number;
    improved: boolean;
}
export declare function computeOracleProgress(current: {
    passCount: number;
    failIndex: number;
    totalTests: number;
}, previous?: {
    passCount: number;
    failIndex: number;
    totalTests: number;
}): OracleProgress;
export declare function scoreEvidence(entries: EvidenceEntry[], oracleProgress?: OracleProgress): {
    score: number;
    level: EvidenceLevel;
    hasAcceptance: boolean;
    oracleWeight: number;
};
export declare function appendEvidenceLedger(rootDir: string, entry: EvidenceEntry): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
