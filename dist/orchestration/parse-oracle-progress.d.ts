export interface ParsedOracleProgress {
    passCount: number;
    failIndex: number;
    totalTests: number;
}
export declare function parseOracleProgressFromText(raw: string): ParsedOracleProgress | null;
