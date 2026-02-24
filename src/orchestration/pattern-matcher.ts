import type { TargetType } from "../state/types";

export interface PatternMatch {
  patternId: string;
  patternName: string;
  confidence: "high" | "medium" | "low";
  targetType: TargetType;
  description: string;
  suggestedApproach: string;
  suggestedTemplate?: string;
  keywords: string[];
}

const KNOWN_PATTERNS: PatternMatch[] = [
  {
    patternId: "buffer-overflow-basic",
    patternName: "Basic Stack Buffer Overflow",
    confidence: "high",
    targetType: "PWN",
    description: "Fixed-size stack buffer with controllable overwrite and likely RIP/EIP control.",
    suggestedApproach:
      "Find exact offset with cyclic pattern, check mitigations (NX/PIE/canary), then pivot to ret2win/ret2libc/ROP based on protections.",
    suggestedTemplate: "pwntools-skeleton",
    keywords: ["buffer overflow", "gets", "strcpy", "stack smash", "rip control", "eip", "overflow"],
  },
  {
    patternId: "format-string-leak",
    patternName: "Format String Leak/Write",
    confidence: "high",
    targetType: "PWN",
    description: "User input reaches printf-like sink without format control sanitization.",
    suggestedApproach:
      "Probe with %p/%x to leak stack/libc, determine argument index, then use %n for targeted writes if needed.",
    suggestedTemplate: "pwntools-skeleton",
    keywords: ["format string", "printf", "%p", "%n", "%x", "vfprintf", "user controlled format"],
  },
  {
    patternId: "heap-tcache-poison",
    patternName: "Heap Tcache Poisoning",
    confidence: "high",
    targetType: "PWN",
    description: "Tcache freelist manipulation enables arbitrary chunk return.",
    suggestedApproach:
      "Check glibc version, leak heap/libc pointers, poison tcache next pointer, then allocate to overwrite hook/vtable target.",
    suggestedTemplate: "pwntools-skeleton",
    keywords: ["tcache", "double free", "free list", "heap chunk", "glibc 2.27", "poison", "malloc"],
  },
  {
    patternId: "heap-uaf",
    patternName: "Heap Use-After-Free",
    confidence: "high",
    targetType: "PWN",
    description: "Freed chunk remains reachable through stale pointer path.",
    suggestedApproach:
      "Map object lifecycle, reclaim freed chunk with controlled data, then hijack function pointer/vtable or metadata for code execution.",
    suggestedTemplate: "pwntools-skeleton",
    keywords: ["use after free", "uaf", "dangling pointer", "free then use", "heap object", "stale reference"],
  },
  {
    patternId: "ret2libc",
    patternName: "ret2libc",
    confidence: "high",
    targetType: "PWN",
    description: "Control flow hijack with NX enabled and libc symbols available via leak.",
    suggestedApproach:
      "Leak libc function address, compute libc base, resolve system and /bin/sh, then craft aligned ROP call chain.",
    suggestedTemplate: "ret2libc-outline",
    keywords: ["ret2libc", "libc leak", "got leak", "plt", "system", "/bin/sh", "nx enabled"],
  },
  {
    patternId: "rop-chain",
    patternName: "ROP Chain Construction",
    confidence: "high",
    targetType: "PWN",
    description: "No direct shellcode execution; chain gadgets to call useful functions/syscalls.",
    suggestedApproach:
      "Collect gadgets for argument registers and stack alignment, then chain leak stage and execution stage with deterministic constraints.",
    suggestedTemplate: "pwntools-skeleton",
    keywords: ["rop", "gadget", "pop rdi", "ret gadget", "chain", "nx", "return oriented"],
  },
  {
    patternId: "srop",
    patternName: "Sigreturn-Oriented Programming",
    confidence: "medium",
    targetType: "PWN",
    description: "Signal frame forgery to control syscall context in limited gadget scenarios.",
    suggestedApproach:
      "Find syscall and sigreturn trigger, forge rt_sigreturn frame on stack, then set registers for execve/mprotect flow.",
    suggestedTemplate: "pwntools-skeleton",
    keywords: ["srop", "sigreturn", "rt_sigreturn", "syscall; ret", "ucontext", "frame forgery"],
  },
  {
    patternId: "ret2dlresolve",
    patternName: "ret2dlresolve",
    confidence: "medium",
    targetType: "PWN",
    description: "Dynamic linker abuse to resolve symbols at runtime without direct libc leak.",
    suggestedApproach:
      "Craft fake relocation/symbol structures on writable memory, invoke plt resolver entry, resolve system and execute payload.",
    suggestedTemplate: "pwntools-skeleton",
    keywords: ["ret2dlresolve", "dl-resolve", "linker", "plt0", "reloc", "dynsym", "dynstr"],
  },
  {
    patternId: "seccomp-bypass",
    patternName: "Seccomp Filter Bypass",
    confidence: "medium",
    targetType: "PWN",
    description: "Restricted syscalls require alternative primitives to get execution impact.",
    suggestedApproach:
      "Recover seccomp policy, choose allowed syscalls, then pivot to open/read/write or ORW-style chain instead of blocked execve.",
    suggestedTemplate: "pwntools-skeleton",
    keywords: ["seccomp", "prctl", "sandbox", "syscall filter", "orw", "bpf"],
  },
  {
    patternId: "stack-pivot",
    patternName: "Stack Pivot",
    confidence: "medium",
    targetType: "PWN",
    description: "Limited overflow but controllable pointer allows moving stack to larger controlled region.",
    suggestedApproach:
      "Locate pivot gadget (leave; ret/xchg rsp), stage second ROP chain in writable buffer, then pivot and execute full chain.",
    suggestedTemplate: "pwntools-skeleton",
    keywords: ["stack pivot", "leave; ret", "xchg rsp", "fake stack", "pivot", "bss chain"],
  },
  {
    patternId: "off-by-one",
    patternName: "Off-by-One Overflow",
    confidence: "medium",
    targetType: "PWN",
    description: "Single-byte overwrite corrupts metadata/size or saved frame state.",
    suggestedApproach:
      "Model exact boundary condition, target size byte/prev_inuse/canary LSB, and chain into controlled allocation or return path.",
    suggestedTemplate: "pwntools-skeleton",
    keywords: ["off by one", "null byte overflow", "size byte", "prev_inuse", "one byte overwrite", "boundary"],
  },
  {
    patternId: "ssti-jinja2",
    patternName: "SSTI in Jinja2",
    confidence: "high",
    targetType: "WEB_API",
    description: "Template expression input is rendered directly by Jinja2/Flask.",
    suggestedApproach:
      "Confirm expression evaluation with arithmetic payload, enumerate object graph safely, then escalate to file read/command execution proof.",
    keywords: ["ssti", "jinja2", "{{7*7}}", "render_template_string", "template injection", "flask"],
  },
  {
    patternId: "sqli-union",
    patternName: "Union-Based SQLi",
    confidence: "high",
    targetType: "WEB_API",
    description: "Query composition allows UNION SELECT data extraction.",
    suggestedApproach:
      "Identify injectable parameter, align column count/types, then extract schema and sensitive fields with minimal-impact payloads.",
    keywords: ["union select", "sql injection", "order by", "database error", "mysql", "postgres", "sqlite"],
  },
  {
    patternId: "sqli-blind",
    patternName: "Blind SQLi",
    confidence: "high",
    targetType: "WEB_API",
    description: "No direct SQL output but boolean/time side-channel present.",
    suggestedApproach:
      "Build deterministic boolean or time-based probes, then extract target data bitwise/charwise with retry and jitter control.",
    keywords: ["blind sqli", "time based", "sleep(", "boolean based", "if(", "pg_sleep", "benchmark("],
  },
  {
    patternId: "ssrf-basic",
    patternName: "SSRF",
    confidence: "high",
    targetType: "WEB_API",
    description: "Server fetches attacker-controlled URL and can reach internal resources.",
    suggestedApproach:
      "Validate outbound fetch, test localhost/metadata/internal hosts with safe probes, then demonstrate controlled internal access impact.",
    keywords: ["ssrf", "url fetch", "metadata", "169.254.169.254", "internal host", "webhook", "proxy"],
  },
  {
    patternId: "jwt-forgery",
    patternName: "JWT Forgery/Confusion",
    confidence: "high",
    targetType: "WEB_API",
    description: "JWT verification weakness (alg confusion/weak secret/kid abuse).",
    suggestedApproach:
      "Inspect token header/alg behavior, test none/HS-RS confusion where applicable, then prove privilege change with signed forgery.",
    keywords: ["jwt", "alg none", "hs256", "rs256", "kid", "jwk", "token forgery"],
  },
  {
    patternId: "deserialization",
    patternName: "Unsafe Deserialization",
    confidence: "medium",
    targetType: "WEB_API",
    description: "Untrusted serialized input reaches dangerous object constructors/gadgets.",
    suggestedApproach:
      "Identify serialization format and sink, craft minimal gadget payload for controlled side effect, then escalate impact carefully.",
    keywords: ["deserialization", "pickle", "java serialization", "ysoserial", "objectinputstream", "gadget chain"],
  },
  {
    patternId: "lfi-rfi",
    patternName: "LFI/RFI",
    confidence: "high",
    targetType: "WEB_API",
    description: "File include/read path is controllable and escapes intended directory.",
    suggestedApproach:
      "Probe traversal normalization, read benign target first, then prove sensitive file exposure or inclusion impact.",
    keywords: ["lfi", "rfi", "path traversal", "../", "php://filter", "include", "file read"],
  },
  {
    patternId: "xxe-injection",
    patternName: "XXE Injection",
    confidence: "medium",
    targetType: "WEB_API",
    description: "XML parser allows external entity expansion.",
    suggestedApproach:
      "Confirm external entity resolution with harmless entity, then demonstrate file read or SSRF through controlled DTD payload.",
    keywords: ["xxe", "doctype", "xml parser", "external entity", "dtd", "sax", "dom4j"],
  },
  {
    patternId: "race-condition",
    patternName: "Race Condition",
    confidence: "medium",
    targetType: "WEB_API",
    description: "Concurrent requests bypass state checks or consume shared resources unsafely.",
    suggestedApproach:
      "Locate check/use boundary, send synchronized concurrent requests, and verify inconsistent final state as reproducible impact.",
    keywords: ["race condition", "toctou", "concurrent request", "double spend", "parallel", "non-atomic"],
  },
  {
    patternId: "prototype-pollution",
    patternName: "Prototype Pollution",
    confidence: "medium",
    targetType: "WEB_API",
    description: "JavaScript object merge/path-set lets attacker control prototype properties.",
    suggestedApproach:
      "Test __proto__/constructor.prototype write paths, confirm polluted property propagation, then prove privilege/logic impact.",
    keywords: ["prototype pollution", "__proto__", "constructor.prototype", "lodash merge", "node", "polluted"],
  },
  {
    patternId: "web3-reentrancy",
    patternName: "WEB3 Reentrancy",
    confidence: "high",
    targetType: "WEB3",
    description: "State is updated after external call, allowing callback re-entry.",
    suggestedApproach:
      "Map call graph and storage writes, implement minimal attacker callback, then prove invariant break with deterministic tx sequence.",
    suggestedTemplate: "web3-reentrancy-checklist",
    keywords: ["reentrancy", "call.value", "external call", "fallback", "receive", "checks-effects-interactions"],
  },
  {
    patternId: "web3-access-control",
    patternName: "WEB3 Access Control Bypass",
    confidence: "high",
    targetType: "WEB3",
    description: "Privileged functions lack robust role/ownership validation.",
    suggestedApproach:
      "Trace modifier and role checks, test alternate code paths (proxy/delegatecall/init), then demonstrate unauthorized state change.",
    keywords: ["onlyowner", "access control", "role", "auth bypass", "delegatecall", "initializer"],
  },
  {
    patternId: "web3-oracle-manipulation",
    patternName: "WEB3 Oracle Manipulation",
    confidence: "high",
    targetType: "WEB3",
    description: "Protocol depends on manipulable price/feed source.",
    suggestedApproach:
      "Measure liquidity/cadence assumptions, simulate adverse price update, then verify liquidation/mint/burn math impact.",
    suggestedTemplate: "web3-oracle-manipulation",
    keywords: ["oracle", "twap", "price feed", "manipulation", "uniswap", "liquidation"],
  },
  {
    patternId: "web3-signature-replay",
    patternName: "WEB3 Signature Replay/Domain Confusion",
    confidence: "medium",
    targetType: "WEB3",
    description: "Signature validation omits nonce/chain/domain constraints.",
    suggestedApproach:
      "Inspect signed struct fields and domain separator usage, then test replay across chains/contracts/nonces.",
    keywords: ["eip712", "signature replay", "nonce", "domain separator", "permit", "chainid"],
  },
  {
    patternId: "web3-storage-collision",
    patternName: "WEB3 Proxy Storage Collision",
    confidence: "medium",
    targetType: "WEB3",
    description: "Proxy/implementation storage layout mismatch corrupts critical slots.",
    suggestedApproach:
      "Compare slot layouts across upgrades, locate overlapping admin/logic state, and prove controlled overwrite path.",
    keywords: ["proxy", "storage collision", "upgradeable", "uups", "transparent proxy", "slot"],
  },
  {
    patternId: "web3-flashloan-economics",
    patternName: "WEB3 Flashloan Economic Attack",
    confidence: "medium",
    targetType: "WEB3",
    description: "Protocol assumptions break under atomic large-capital manipulation.",
    suggestedApproach:
      "Model transaction atomicity and state checkpoints, simulate flashloan path, and compute profitability/feasibility bounds.",
    keywords: ["flashloan", "economic attack", "atomic", "defi", "sandwich", "price impact"],
  },
  {
    patternId: "misc-osint-pivot",
    patternName: "MISC OSINT Pivot",
    confidence: "medium",
    targetType: "MISC",
    description: "Challenge solution requires correlating weak public signals into a high-confidence lead.",
    suggestedApproach:
      "Collect source-cited clues, build timeline/entity map, and disconfirm top hypothesis before deep branching.",
    suggestedTemplate: "misc-osint-evidence-loop",
    keywords: ["osint", "timeline", "username pivot", "archive", "metadata", "citation"],
  },
  {
    patternId: "misc-encoding-chain",
    patternName: "MISC Multi-Stage Encoding",
    confidence: "medium",
    targetType: "MISC",
    description: "Artifact uses layered encodings/compressions causing misleading partial outputs.",
    suggestedApproach:
      "Detect encode/decode layers iteratively, validate each layer checksum/structure, and avoid lossy transforms.",
    keywords: ["base64", "hex", "rot", "gzip", "xor", "multi-stage"],
  },
  {
    patternId: "misc-logic-constraint",
    patternName: "MISC Logic/Constraint Puzzle",
    confidence: "medium",
    targetType: "MISC",
    description: "Puzzle is solvable via explicit constraints rather than brute-force search.",
    suggestedApproach:
      "Formalize rules as constraints, solve with SAT/SMT or guided search, and verify solution against original checker.",
    keywords: ["logic puzzle", "constraint", "sat", "smt", "state search", "invariant"],
  },
  {
    patternId: "rsa-small-e",
    patternName: "RSA Small Exponent",
    confidence: "high",
    targetType: "CRYPTO",
    description: "Low exponent with weak padding/no padding enables direct root or broadcast attacks.",
    suggestedApproach:
      "Check padding mode and message bounds, then apply integer root or Hastad-style recovery with verifiable small test vectors.",
    keywords: ["rsa", "small e", "e=3", "hastad", "no padding", "integer root", "broadcast"],
  },
  {
    patternId: "rsa-common-modulus",
    patternName: "RSA Common Modulus",
    confidence: "high",
    targetType: "CRYPTO",
    description: "Same modulus reused with different coprime exponents.",
    suggestedApproach:
      "Verify same N and gcd(e1,e2)=1, apply extended Euclid on exponents, combine ciphertext powers to recover plaintext.",
    keywords: ["common modulus", "same n", "rsa", "extended euclid", "coprime exponents", "bezout"],
  },
  {
    patternId: "rsa-wiener",
    patternName: "RSA Wiener Attack",
    confidence: "medium",
    targetType: "CRYPTO",
    description: "Private exponent d too small and recoverable via continued fractions.",
    suggestedApproach:
      "Test Wiener conditions quickly, run continued fraction convergents, then verify recovered key by encryption/decryption round trip.",
    keywords: ["wiener", "continued fraction", "small d", "rsa weak key", "convergent", "private exponent"],
  },
  {
    patternId: "aes-ecb-oracle",
    patternName: "AES ECB Oracle",
    confidence: "high",
    targetType: "CRYPTO",
    description: "Deterministic ECB encryption oracle leaks plaintext structure/bytes.",
    suggestedApproach:
      "Confirm ECB block repetition, derive block size, then perform byte-at-a-time dictionary attack with alignment control.",
    suggestedTemplate: "ecb-byte-at-a-time",
    keywords: ["aes ecb", "oracle", "byte at a time", "deterministic block", "repeated blocks", "chosen plaintext"],
  },
  {
    patternId: "aes-cbc-bitflip",
    patternName: "AES CBC Bit-Flipping",
    confidence: "high",
    targetType: "CRYPTO",
    description: "CBC malleability permits controlled plaintext change without key knowledge.",
    suggestedApproach:
      "Locate target plaintext block, compute xor delta against previous ciphertext block, then verify privilege field flip.",
    keywords: ["cbc bitflip", "aes cbc", "malleability", "iv manipulation", "xor delta", "admin=true"],
  },
  {
    patternId: "padding-oracle",
    patternName: "CBC Padding Oracle",
    confidence: "high",
    targetType: "CRYPTO",
    description: "Padding validity side-channel allows plaintext recovery/forgery.",
    suggestedApproach:
      "Stabilize oracle signal, recover plaintext bytewise from tail, then optionally forge valid ciphertext for target message.",
    suggestedTemplate: "padding-oracle-loop",
    keywords: ["padding oracle", "pkcs7", "cbc", "invalid padding", "oracle", "bytewise decryption"],
  },
  {
    patternId: "hash-length-extension",
    patternName: "Hash Length Extension",
    confidence: "medium",
    targetType: "CRYPTO",
    description: "MAC built as hash(secret || message) on Merkle-Damgard hash is forgeable.",
    suggestedApproach:
      "Identify vulnerable construction and hash family, brute-force key length candidates, then append controlled suffix with valid MAC.",
    keywords: ["length extension", "sha1", "md5", "secret prefix", "merkle damgard", "mac forgery"],
  },
  {
    patternId: "discrete-log",
    patternName: "Discrete Log Weak Parameters",
    confidence: "medium",
    targetType: "CRYPTO",
    description: "Group parameters permit tractable DLP solution (small subgroup/smooth order).",
    suggestedApproach:
      "Factor group order where possible, use baby-step giant-step or Pohlig-Hellman, then verify secret reconstruction.",
    keywords: ["discrete log", "dh", "pohlig hellman", "baby-step giant-step", "smooth order", "small subgroup"],
  },
  {
    patternId: "xor-known-plaintext",
    patternName: "XOR Known-Plaintext",
    confidence: "high",
    targetType: "CRYPTO",
    description: "XOR keystream reused or partially known allowing key recovery.",
    suggestedApproach:
      "Use known plaintext crib to recover keystream segment, extend by consistency checks, and decrypt remaining ciphertext.",
    keywords: ["xor", "known plaintext", "crib", "reused key", "one time pad reuse", "keystream"],
  },
  {
    patternId: "mt19937-predict",
    patternName: "MT19937 State Prediction",
    confidence: "medium",
    targetType: "CRYPTO",
    description: "Enough PRNG outputs leak internal MT19937 state and future outputs.",
    suggestedApproach:
      "Collect sufficient outputs, untemper to reconstruct state, then predict future values or recover seed path.",
    keywords: ["mt19937", "mersenne twister", "untemper", "prng", "predict output", "seed recovery"],
  },
  {
    patternId: "anti-debug",
    patternName: "Anti-Debug Techniques",
    confidence: "medium",
    targetType: "REV",
    description: "Binary actively detects debugger/instrumentation to alter control flow.",
    suggestedApproach:
      "Identify anti-debug checks (ptrace/timing/self-check), patch or emulate bypass, then re-run with parity artifacts.",
    keywords: ["anti debug", "ptrace", "isdebuggerpresent", "timing check", "debug detect", "self check"],
  },
  {
    patternId: "vm-obfuscation",
    patternName: "VM-Based Obfuscation",
    confidence: "medium",
    targetType: "REV",
    description: "Custom bytecode VM hides core logic behind dispatcher and handlers.",
    suggestedApproach:
      "Locate VM loop and handler table, lift bytecode semantics, then solve/check constraints from reconstructed VM instructions.",
    keywords: ["vm", "bytecode", "dispatcher", "handler", "virtual machine", "obfuscation"],
  },
  {
    patternId: "angr-solvable",
    patternName: "Angr-Solvable Constraint Path",
    confidence: "medium",
    targetType: "REV",
    description: "Program path conditions are suitable for symbolic execution.",
    suggestedApproach:
      "Isolate win/lose addresses, model input bytes as symbolic vars, constrain bad paths away, and solve for accepted input.",
    keywords: ["angr", "symbolic execution", "find avoid", "path constraints", "claripy", "solve input"],
  },
  {
    patternId: "z3-constraints",
    patternName: "Z3 Constraint Solving",
    confidence: "high",
    targetType: "REV",
    description: "Validation logic is arithmetic/bitwise constraints directly translatable to SMT.",
    suggestedApproach:
      "Extract exact constraints from decompilation, encode as bit-vectors in z3, solve, and validate candidate on original binary.",
    keywords: ["z3", "constraints", "bit vector", "smt", "equation", "symbolic solver"],
  },
  {
    patternId: "self-modifying-code",
    patternName: "Self-Modifying Code",
    confidence: "medium",
    targetType: "REV",
    description: "Runtime code/data mutation invalidates naive static analysis assumptions.",
    suggestedApproach:
      "Trace runtime writes to executable/validation regions, dump post-decryption stages, and analyze stabilized code snapshot.",
    keywords: ["self modifying", "runtime patch", "unpack", "decrypt code", "jit", "write xor execute"],
  },
  {
    patternId: "steganography-lsb",
    patternName: "Steganography LSB",
    confidence: "high",
    targetType: "FORENSICS",
    description: "Payload hidden in image/audio least-significant bits or channel ordering.",
    suggestedApproach:
      "Inspect metadata and channels, extract LSB planes with multiple bit orders, then validate decoded payload structure.",
    keywords: ["steganography", "lsb", "steg", "png", "bitmap", "hidden message", "channels"],
  },
  {
    patternId: "pcap-extraction",
    patternName: "PCAP Stream Extraction",
    confidence: "high",
    targetType: "FORENSICS",
    description: "Key evidence/flag resides in network capture streams or transferred files.",
    suggestedApproach:
      "Identify suspicious protocols/hosts, reconstruct streams/files, then carve/decode transferred artifacts for final evidence.",
    keywords: ["pcap", "wireshark", "tcp stream", "http objects", "dns exfil", "packet capture"],
  },
  {
    patternId: "memory-dump",
    patternName: "Memory Dump Analysis",
    confidence: "medium",
    targetType: "FORENSICS",
    description: "Secrets/process traces recoverable from volatile memory snapshot.",
    suggestedApproach:
      "Profile memory image, enumerate processes/connections, extract credentials/command history/artifacts, and cross-check timeline.",
    keywords: ["memory dump", "volatility", "ram", "process list", "lsass", "mem image"],
  },
  {
    patternId: "disk-image",
    patternName: "Disk Image Timeline",
    confidence: "medium",
    targetType: "FORENSICS",
    description: "Filesystem artifacts in raw disk image reveal deleted/hidden data.",
    suggestedApproach:
      "Mount image read-only, inspect partitions/filesystems, recover deleted entries, and build timeline from metadata.",
    keywords: ["disk image", "forensic image", "partition", "mft", "ext4", "deleted files", "timeline"],
  },
  {
    patternId: "file-carving",
    patternName: "File Carving",
    confidence: "medium",
    targetType: "FORENSICS",
    description: "Embedded payload exists in unallocated/slack or concatenated binary blobs.",
    suggestedApproach:
      "Locate magic bytes and boundaries, carve candidate files, then validate headers/checksums and recurse into nested containers.",
    keywords: ["file carving", "magic bytes", "binwalk", "foremost", "slack space", "embedded file"],
  },
];

const CONFIDENCE_RANK: Record<PatternMatch["confidence"], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toTokenSet(text: string): Set<string> {
  const parts = text
    .split(/[^a-z0-9_+./%-]+/i)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  return new Set(parts);
}

function keywordMatched(normalizedText: string, tokens: Set<string>, keyword: string): boolean {
  const normalizedKeyword = normalize(keyword);
  if (!normalizedKeyword) {
    return false;
  }
  if (normalizedKeyword.length <= 3) {
    return tokens.has(normalizedKeyword);
  }
  if (normalizedKeyword.includes(" ") || normalizedKeyword.includes("-") || normalizedKeyword.includes("/")) {
    return normalizedText.includes(normalizedKeyword);
  }
  return tokens.has(normalizedKeyword) || normalizedText.includes(normalizedKeyword);
}

function mergeConfidence(
  baseline: PatternMatch["confidence"],
  hits: number,
  totalKeywords: number
): PatternMatch["confidence"] {
  if (totalKeywords <= 0) {
    return baseline;
  }
  const ratio = hits / totalKeywords;
  const derived: PatternMatch["confidence"] = ratio >= 0.6 ? "high" : ratio >= 0.35 ? "medium" : "low";
  return CONFIDENCE_RANK[derived] > CONFIDENCE_RANK[baseline] ? derived : baseline;
}

/**
 * Match challenge or analysis text against known CTF patterns.
 */
export function matchPatterns(text: string, targetType?: TargetType): PatternMatch[] {
  const normalizedText = normalize(text ?? "");
  if (!normalizedText) {
    return [];
  }

  const tokens = toTokenSet(normalizedText);
  const scoredMatches = KNOWN_PATTERNS.filter((pattern) => (targetType ? pattern.targetType === targetType : true))
    .map((pattern) => {
      const validKeywords = pattern.keywords.map(normalize).filter((keyword) => keyword.length > 0);
      const hits = validKeywords.filter((keyword) => keywordMatched(normalizedText, tokens, keyword));
      const phraseHit = hits.some((keyword) => keyword.includes(" ") || keyword.includes("-") || keyword.includes("/"));
      const hitCount = hits.length;
      const ratio = validKeywords.length > 0 ? hitCount / validKeywords.length : 0;
      const shouldInclude = hitCount >= 2 || ratio >= 0.34 || phraseHit;
      if (!shouldInclude) {
        return null;
      }
      const score = hitCount * 10 + Math.round(ratio * 100);
      return {
        pattern: {
          ...pattern,
          confidence: mergeConfidence(pattern.confidence, hitCount, validKeywords.length),
        },
        score,
      };
    })
    .filter((entry): entry is { pattern: PatternMatch; score: number } => entry !== null);

  return scoredMatches
    .sort((a, b) => {
      const confDiff = CONFIDENCE_RANK[b.pattern.confidence] - CONFIDENCE_RANK[a.pattern.confidence];
      if (confDiff !== 0) {
        return confDiff;
      }
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.pattern.patternId.localeCompare(b.pattern.patternId);
    })
    .map((entry) => entry.pattern);
}

/**
 * Get a known pattern by ID.
 */
export function getPattern(patternId: string): PatternMatch | null {
  const normalizedId = normalize(patternId);
  if (!normalizedId) {
    return null;
  }
  return KNOWN_PATTERNS.find((pattern) => pattern.patternId === normalizedId) ?? null;
}

/**
 * List all known patterns, optionally filtering by target type.
 */
export function listPatterns(targetType?: TargetType): PatternMatch[] {
  return KNOWN_PATTERNS.filter((pattern) => (targetType ? pattern.targetType === targetType : true));
}

/**
 * Build a compact prompt summary from matched patterns.
 */
export function buildPatternSummary(matches: PatternMatch[]): string {
  if (!matches || matches.length === 0) {
    return "No strong known CTF pattern matches found. Continue SCAN with 2-4 hypotheses and cheapest disconfirm tests.";
  }

  const lines = [
    `Known pattern matches: ${matches.length}`,
    "Use highest-confidence items first and run the cheapest disconfirm test before deep execution.",
  ];

  for (const match of matches) {
    const templatePart = match.suggestedTemplate ? ` | template=${match.suggestedTemplate}` : "";
    lines.push(
      `- [${match.confidence}] ${match.patternName} (${match.patternId}, ${match.targetType})${templatePart}`,
      `  approach: ${match.suggestedApproach}`,
      `  keywords: ${match.keywords.join(", ")}`
    );
  }

  return lines.join("\n");
}
