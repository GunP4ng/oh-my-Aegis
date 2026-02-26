/**
 * Hypothesis Experiment Registry
 *
 * Structured storage for hypothesis → disconfirm experiment → evidence → verdict.
 * Prevents re-running identical experiments and enables audit trail.
 */
export type HypothesisStatus = "active" | "confirmed" | "refuted" | "superseded" | "stale";
export type ExperimentVerdict = "supports" | "refutes" | "inconclusive";
export interface Experiment {
    id: string;
    description: string;
    method: string;
    artifactPaths: string[];
    verdict: ExperimentVerdict;
    evidence: string;
    timestamp: string;
}
export interface HypothesisRecord {
    id: string;
    hypothesis: string;
    status: HypothesisStatus;
    createdAt: string;
    updatedAt: string;
    experiments: Experiment[];
    supersededBy?: string;
    tags: string[];
}
export declare class HypothesisRegistry {
    private records;
    private readonly storePath;
    private nextId;
    private nextExpId;
    constructor(rootDir: string);
    private load;
    private persist;
    createHypothesis(hypothesis: string, tags?: string[]): HypothesisRecord;
    addExperiment(hypothesisId: string, description: string, method: string, artifactPaths: string[], verdict: ExperimentVerdict, evidence: string): Experiment | null;
    updateStatus(hypothesisId: string, status: HypothesisStatus, supersededBy?: string): boolean;
    getActive(): HypothesisRecord[];
    getAll(): HypothesisRecord[];
    get(id: string): HypothesisRecord | undefined;
    /**
     * Check if a specific method+description experiment has already been run
     * for ANY active hypothesis, preventing duplicate experiments.
     */
    hasExperiment(method: string, description: string): boolean;
    /**
     * Mark all active hypotheses as stale when context or approach fundamentally shifts.
     */
    markAllActiveAsStale(): number;
    /**
     * Generate a summary of all hypotheses and experiments for context injection.
     */
    summarize(): string;
}
