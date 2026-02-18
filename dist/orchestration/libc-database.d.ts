export interface LibcMatch {
    id: string;
    buildId?: string;
    symbols: Record<string, number>;
}
export interface LibcLookupRequest {
    symbolName: string;
    address: string;
}
export interface LibcLookupResult {
    matches: LibcMatch[];
    lookupSource: string;
    query: LibcLookupRequest[];
}
/**
 * Extract the last 3 hex nibbles from an address.
 */
export declare function extractOffset(address: string): string;
/**
 * Perform local libc lookup by matching leaked symbol low 12-bit offsets.
 */
export declare function localLookup(requests: LibcLookupRequest[]): LibcLookupResult;
/**
 * Build libc.rip API lookup URL from leaked symbol requests.
 */
export declare function buildLibcRipUrl(requests: LibcLookupRequest[]): string;
/**
 * Build a libc-database command for local shell usage.
 */
export declare function buildLibcDbCommand(requests: LibcLookupRequest[]): string;
/**
 * Return useful exploitation offsets for a selected libc.
 */
export declare function getUsefulOffsets(libc: LibcMatch): Record<string, number | null>;
/**
 * Build a readable summary from libc lookup result.
 */
export declare function buildLibcSummary(result: LibcLookupResult): string;
/**
 * Compute libc base address from leaked runtime address and symbol offset.
 */
export declare function computeLibcBase(leakedAddress: string, symbolOffset: number): string;
