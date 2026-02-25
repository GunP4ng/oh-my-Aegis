export interface ContradictionRunnerInput {
    hypothesis: string;
    expected: string[];
    observedOutput: string;
    expectedExitCode?: number;
    observedExitCode?: number;
}
export interface ContradictionRunnerResult {
    contradictory: boolean;
    matchedExpected: string[];
    missingExpected: string[];
    exitCodeMismatch: boolean;
    summary: string;
}
export declare function runContradictionRunner(input: ContradictionRunnerInput): ContradictionRunnerResult;
