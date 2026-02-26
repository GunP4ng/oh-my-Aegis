/**
 * REV toolkit: common utilities for reverse-engineering challenges involving
 * relocation-based VMs, embedded ELFs, and custom encoding schemes.
 */
export interface RelaEntry {
    offset: number;
    type: number;
    symbol: number;
    addend: number;
}
export declare function parseRelaEntries(readelfRelocOutput: string): RelaEntry[];
/**
 * Generate a patch script (Python) that replaces the r_offset of a
 * target RELA entry with a dummy address to neutralize relocation clearing.
 */
export declare function generateRelaPatchScript(binaryPath: string, sectionOffset: number, entryIndex: number, dummyAddress?: number): string;
export interface SyscallStubConfig {
    writeAddr1: number;
    writeLen1: number;
    writeAddr2: number;
    writeLen2: number;
}
/**
 * Generate x86_64 syscall trampoline shellcode (as hex bytes) that:
 *   write(1, addr1, len1) → write(1, addr2, len2) → exit(0)
 */
export declare function generateSyscallTrampoline(cfg: SyscallStubConfig): string;
/**
 * Generate a Python pwntools patch script that overwrites a binary entry
 * point with a syscall trampoline for buffer extraction.
 */
export declare function generateEntryPatchScript(binaryPath: string, entryVaddr: number, cfg: SyscallStubConfig): string;
/**
 * Encode raw bytes into base255 big-endian representation (no 0x00 bytes).
 * Each chunk of `chunkSize` bytes → one base255 big-endian number → `chunkSize + 1` bytes.
 */
export declare function base255Encode(data: Uint8Array, chunkSize?: number): Uint8Array;
/**
 * Decode base255 big-endian encoded bytes back to raw data.
 * Each `chunkSize + 1` encoded bytes → `chunkSize` raw bytes.
 */
export declare function base255Decode(encoded: Uint8Array, chunkSize?: number): Uint8Array;
export interface LinearRecoveryParams {
    multiplier: number;
    inverseMultiplier: number;
    modulus: number;
}
/**
 * Compute modular inverse using extended Euclidean algorithm.
 */
export declare function modInverse(a: number, m: number): number;
/**
 * Given out[i] = mul*input[i] + k[i] (mod modulus) and
 *       expected[i] = mul*real[i] + k[i] (mod modulus),
 * recover real_arg bytes from (out, expected) pairs.
 */
export declare function recoverLinear(outBytes: Uint8Array, expectedBytes: Uint8Array, params: LinearRecoveryParams): Uint8Array;
/**
 * Generate a Python script for linear recovery from dumped (out, expected) buffers.
 */
export declare function generateLinearRecoveryScript(dumpDir: string, binCount: number, multiplier: number, modulus?: number, chunkSize?: number): string;
