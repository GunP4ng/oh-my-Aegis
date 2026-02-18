export interface ScanSnapshot {
    id: string;
    timestamp: number;
    target: string;
    assets: string[];
    findings: string[];
    templateSet: string;
}
export interface DeltaResult {
    newAssets: string[];
    removedAssets: string[];
    newFindings: string[];
    resolvedFindings: string[];
    templateChanged: boolean;
    summary: string;
}
/**
 * Save a scan snapshot in memory for a target.
 */
export declare function saveScanSnapshot(snapshot: ScanSnapshot): void;
/**
 * Get the latest scan snapshot for a target.
 */
export declare function getLatestSnapshot(target: string): ScanSnapshot | null;
/**
 * Compute added/removed assets and findings between snapshots.
 */
export declare function computeDelta(previous: ScanSnapshot, current: ScanSnapshot): DeltaResult;
/**
 * Return all known snapshots for a target.
 */
export declare function getScanHistory(target: string): ScanSnapshot[];
/**
 * Build a summary describing scan deltas versus the previous snapshot.
 */
export declare function buildDeltaSummary(target: string, current: ScanSnapshot): string;
/**
 * Determine whether a target should be rescanned.
 */
export declare function shouldRescan(target: string, templateSet: string, maxAgeMs?: number): boolean;
