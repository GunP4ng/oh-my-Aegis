export interface ParityRunnerInput {
    localOutput?: string;
    dockerOutput?: string;
    remoteOutput?: string;
}
export interface ParityPairDiff {
    pair: string;
    match: boolean;
    leftHash: string;
    rightHash: string;
}
export interface ParityRunnerResult {
    ok: boolean;
    checkedPairs: number;
    diffs: ParityPairDiff[];
    summary: string;
}
export declare function runParityRunner(input: ParityRunnerInput): ParityRunnerResult;
