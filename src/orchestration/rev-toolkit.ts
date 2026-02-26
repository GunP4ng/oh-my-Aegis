/**
 * REV toolkit: common utilities for reverse-engineering challenges involving
 * relocation-based VMs, embedded ELFs, and custom encoding schemes.
 */

// ─── RELA entry patch helper ───

export interface RelaEntry {
  offset: number;
  type: number;
  symbol: number;
  addend: number;
}

export function parseRelaEntries(readelfRelocOutput: string): RelaEntry[] {
  const entries: RelaEntry[] = [];
  const lineRe = /^\s*([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+\S+\s+([0-9a-fA-F]+)\s+([+-]?[0-9a-fA-F]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(readelfRelocOutput)) !== null) {
    entries.push({
      offset: parseInt(match[1], 16),
      type: parseInt(match[2], 16) & 0xffffffff,
      symbol: parseInt(match[3], 16),
      addend: parseInt(match[4], 16),
    });
  }
  return entries;
}

/**
 * Generate a patch script (Python) that replaces the r_offset of a
 * target RELA entry with a dummy address to neutralize relocation clearing.
 */
export function generateRelaPatchScript(
  binaryPath: string,
  sectionOffset: number,
  entryIndex: number,
  dummyAddress: number = 0xdead0000,
): string {
  const entryOffset = sectionOffset + entryIndex * 24;
  return [
    `#!/usr/bin/env python3`,
    `"""Patch RELA entry ${entryIndex} r_offset to neutralize clearing."""`,
    `import struct, shutil, sys`,
    ``,
    `src = ${JSON.stringify(binaryPath)}`,
    `dst = src + ".patched"`,
    `shutil.copy2(src, dst)`,
    ``,
    `with open(dst, "r+b") as f:`,
    `    f.seek(${entryOffset})`,
    `    f.write(struct.pack("<Q", ${dummyAddress}))  # overwrite r_offset`,
    ``,
    `print(f"Patched RELA entry at offset 0x{${entryOffset}:x} -> r_offset=0x{${dummyAddress}:x}")`,
    `print(f"Output: {dst}")`,
  ].join("\n");
}

// ─── Syscall trampoline generator ───

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
export function generateSyscallTrampoline(cfg: SyscallStubConfig): string {
  const lines: string[] = [
    `# write(1, 0x${cfg.writeAddr1.toString(16)}, ${cfg.writeLen1})`,
    `mov rax, 1`,
    `mov rdi, 1`,
    `mov rsi, 0x${cfg.writeAddr1.toString(16)}`,
    `mov rdx, ${cfg.writeLen1}`,
    `syscall`,
    ``,
    `# write(1, 0x${cfg.writeAddr2.toString(16)}, ${cfg.writeLen2})`,
    `mov rax, 1`,
    `mov rdi, 1`,
    `mov rsi, 0x${cfg.writeAddr2.toString(16)}`,
    `mov rdx, ${cfg.writeLen2}`,
    `syscall`,
    ``,
    `# exit(0)`,
    `mov rax, 60`,
    `xor rdi, rdi`,
    `syscall`,
  ];
  return lines.join("\n");
}

/**
 * Generate a Python pwntools patch script that overwrites a binary entry
 * point with a syscall trampoline for buffer extraction.
 */
export function generateEntryPatchScript(
  binaryPath: string,
  entryVaddr: number,
  cfg: SyscallStubConfig,
): string {
  return [
    `#!/usr/bin/env python3`,
    `"""Patch entry to syscall trampoline for runtime buffer extraction."""`,
    `from pwn import *`,
    `import shutil`,
    ``,
    `src = ${JSON.stringify(binaryPath)}`,
    `dst = src + ".stub"`,
    `shutil.copy2(src, dst)`,
    ``,
    `elf = ELF(dst)`,
    ``,
    `# Build trampoline: write(1, buf_out, 8) + write(1, buf_expected, 8) + exit(0)`,
    `shellcode = asm(`,
    `    f"""`,
    `    mov rax, 1`,
    `    mov rdi, 1`,
    `    mov rsi, {hex(cfg.writeAddr1)}`,
    `    mov rdx, {cfg.writeLen1}`,
    `    syscall`,
    `    mov rax, 1`,
    `    mov rdi, 1`,
    `    mov rsi, {hex(cfg.writeAddr2)}`,
    `    mov rdx, {cfg.writeLen2}`,
    `    syscall`,
    `    mov rax, 60`,
    `    xor rdi, rdi`,
    `    syscall`,
    `    """,`,
    `    arch="amd64"`,
    `)`,
    ``,
    `vaddr = ${hex(entryVaddr)}`,
    `offset = elf.vaddr_to_offset(vaddr)`,
    ``,
    `with open(dst, "r+b") as f:`,
    `    f.seek(offset)`,
    `    f.write(shellcode)`,
    ``,
    `print(f"Patched entry 0x{vaddr:x} (offset 0x{offset:x}) with {len(shellcode)}-byte trampoline")`,
    `print(f"Output: {dst}")`,
  ].join("\n");
}

function hex(n: number): string {
  return `0x${n.toString(16)}`;
}

// ─── Base255 encoder/decoder ───

/**
 * Encode raw bytes into base255 big-endian representation (no 0x00 bytes).
 * Each chunk of `chunkSize` bytes → one base255 big-endian number → `chunkSize + 1` bytes.
 */
export function base255Encode(data: Uint8Array, chunkSize: number = 7): Uint8Array {
  const result: number[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    let value = 0n;
    for (const byte of chunk) {
      value = (value << 8n) | BigInt(byte);
    }
    const encoded: number[] = [];
    const outputLen = chunk.length + 1;
    for (let j = 0; j < outputLen; j++) {
      const remainder = Number(value % 255n);
      encoded.unshift(remainder + 1);
      value = value / 255n;
    }
    result.push(...encoded);
  }
  return new Uint8Array(result);
}

/**
 * Decode base255 big-endian encoded bytes back to raw data.
 * Each `chunkSize + 1` encoded bytes → `chunkSize` raw bytes.
 */
export function base255Decode(encoded: Uint8Array, chunkSize: number = 7): Uint8Array {
  const encodedChunkSize = chunkSize + 1;
  const result: number[] = [];
  for (let i = 0; i < encoded.length; i += encodedChunkSize) {
    const chunk = encoded.slice(i, Math.min(i + encodedChunkSize, encoded.length));
    let value = 0n;
    for (const byte of chunk) {
      value = value * 255n + BigInt(byte - 1);
    }
    const decoded: number[] = [];
    for (let j = 0; j < chunkSize; j++) {
      decoded.unshift(Number(value & 0xffn));
      value = value >> 8n;
    }
    result.push(...decoded);
  }
  return new Uint8Array(result);
}

// ─── Linear recovery template ───

export interface LinearRecoveryParams {
  multiplier: number;
  inverseMultiplier: number;
  modulus: number;
}

/**
 * Compute modular inverse using extended Euclidean algorithm.
 */
export function modInverse(a: number, m: number): number {
  let [old_r, r] = [a % m, m];
  let [old_s, s] = [1, 0];
  while (r !== 0) {
    const quotient = Math.floor(old_r / r);
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }
  return ((old_s % m) + m) % m;
}

/**
 * Given out[i] = mul*input[i] + k[i] (mod modulus) and
 *       expected[i] = mul*real[i] + k[i] (mod modulus),
 * recover real_arg bytes from (out, expected) pairs.
 */
export function recoverLinear(
  outBytes: Uint8Array,
  expectedBytes: Uint8Array,
  params: LinearRecoveryParams,
): Uint8Array {
  if (outBytes.length !== expectedBytes.length) {
    throw new Error(`Length mismatch: out=${outBytes.length} expected=${expectedBytes.length}`);
  }
  const inv = params.inverseMultiplier || modInverse(params.multiplier, params.modulus);
  const result = new Uint8Array(outBytes.length);
  for (let i = 0; i < outBytes.length; i++) {
    const diff = ((expectedBytes[i] - outBytes[i]) % params.modulus + params.modulus) % params.modulus;
    result[i] = (inv * diff) % params.modulus;
  }
  return result;
}

/**
 * Generate a Python script for linear recovery from dumped (out, expected) buffers.
 */
export function generateLinearRecoveryScript(
  dumpDir: string,
  binCount: number,
  multiplier: number,
  modulus: number = 256,
  chunkSize: number = 7,
): string {
  const inv = modInverse(multiplier, modulus);
  return [
    `#!/usr/bin/env python3`,
    `"""Recover original file from dumped (out, expected) buffer pairs."""`,
    `import struct, os`,
    ``,
    `DUMP_DIR = ${JSON.stringify(dumpDir)}`,
    `BIN_COUNT = ${binCount}`,
    `MUL = ${multiplier}`,
    `INV_MUL = ${inv}  # modular inverse of ${multiplier} mod ${modulus}`,
    `MOD = ${modulus}`,
    `CHUNK_SIZE = ${chunkSize}`,
    ``,
    `def base255_decode(encoded, chunk_size=${chunkSize}):`,
    `    enc_chunk = chunk_size + 1`,
    `    result = bytearray()`,
    `    for i in range(0, len(encoded), enc_chunk):`,
    `        c = encoded[i:i+enc_chunk]`,
    `        val = 0`,
    `        for b in c:`,
    `            val = val * 255 + (b - 1)`,
    `        raw = val.to_bytes(chunk_size, "big")`,
    `        result.extend(raw)`,
    `    return bytes(result)`,
    ``,
    `result = bytearray()`,
    `for idx in range(BIN_COUNT):`,
    `    out_path = os.path.join(DUMP_DIR, f"bin{idx:03d}.out")`,
    `    exp_path = os.path.join(DUMP_DIR, f"bin{idx:03d}.expected")`,
    `    with open(out_path, "rb") as f:`,
    `        out_data = f.read()`,
    `    with open(exp_path, "rb") as f:`,
    `        exp_data = f.read()`,
    `    real_arg = bytes((INV_MUL * ((e - o) % MOD)) % MOD for o, e in zip(out_data, exp_data))`,
    `    chunk = base255_decode(real_arg, CHUNK_SIZE)`,
    `    result.extend(chunk)`,
    ``,
    `# Trim padding (last 2 bytes for 6963-byte files)`,
    `with open("recovered_file", "wb") as f:`,
    `    f.write(result)`,
    `print(f"Recovered {len(result)} bytes -> recovered_file")`,
  ].join("\n");
}
