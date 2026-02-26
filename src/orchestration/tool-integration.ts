import type { TargetType } from "../state/types";

export interface ToolCommand {
  tool: string;
  command: string;
  purpose: string;
  outputParser?: string;
}

export interface ChecksecResult {
  relro: "Full" | "Partial" | "No";
  canary: boolean;
  nx: boolean;
  pie: boolean;
  rpath: boolean;
  runpath: boolean;
  fortify: boolean;
  stripped: boolean;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  rawOutput: string;
  parsed: Record<string, unknown>;
  summary: string;
}

const DEFAULT_NUCLEI_RATE_LIMIT = 50;
const MIN_NUCLEI_RATE_LIMIT = 1;
const MAX_NUCLEI_RATE_LIMIT = 200;
const MIN_ROP_DEPTH = 1;
const MAX_ROP_DEPTH = 40;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function detectChecksecBoolean(output: string, enabled: RegExp[], disabled: RegExp[]): boolean {
  if (disabled.some((pattern) => pattern.test(output))) {
    return false;
  }
  return enabled.some((pattern) => pattern.test(output));
}

/**
 * Generate a checksec command for hardening inspection.
 */
export function checksecCommand(binaryPath: string): ToolCommand {
  return {
    tool: "checksec",
    command: `checksec --file=${shellQuote(binaryPath)}`,
    purpose: "Inspect binary hardening protections",
    outputParser: "parseChecksecOutput",
  };
}

/**
 * Parse checksec output into a structured hardening report.
 */
export function parseChecksecOutput(output: string): ChecksecResult | null {
  const normalized = output.replace(/\r/g, "").trim();
  if (!normalized) {
    return null;
  }

  const hasRelevantSignals =
    /\brelro\b/i.test(normalized) ||
    /\bcanary\b/i.test(normalized) ||
    /\bnx\b/i.test(normalized) ||
    /\bpie\b/i.test(normalized) ||
    /\brpath\b/i.test(normalized) ||
    /\brunpath\b/i.test(normalized) ||
    /\bfortify\b/i.test(normalized) ||
    /\bstripped\b/i.test(normalized);

  if (!hasRelevantSignals) {
    return null;
  }

  const relroMatch =
    normalized.match(/\bRELRO\s*:\s*(Full|Partial|No)\b/i) ??
    normalized.match(/\b(Full|Partial|No)\s+RELRO\b/i);

  const relroRaw = relroMatch?.[1]?.toLowerCase();
  const relro: ChecksecResult["relro"] = relroRaw === "full" ? "Full" : relroRaw === "partial" ? "Partial" : "No";

  const canary = detectChecksecBoolean(
    normalized,
    [
      /\bcanary\s*:\s*(yes|enabled|true|found)\b/i,
      /\bstack\s+canary\s+found\b/i,
      /\bcanary\s+found\b/i,
    ],
    [/\bcanary\s*:\s*(no|disabled|false)\b/i, /\bno\s+canary\s+found\b/i]
  );

  const nx = detectChecksecBoolean(
    normalized,
    [/\bnx\s*:\s*(yes|enabled|true)\b/i, /\bnx\s+enabled\b/i],
    [/\bnx\s*:\s*(no|disabled|false)\b/i, /\bnx\s+disabled\b/i]
  );

  const pie = detectChecksecBoolean(
    normalized,
    [/\bpie\s*:\s*(yes|enabled|true)\b/i, /\bpie\s+enabled\b/i],
    [/\bpie\s*:\s*(no|disabled|false)\b/i, /\bno\s+pie\b/i]
  );

  const rpath = detectChecksecBoolean(
    normalized,
    [/\brpath\s*:\s*(yes|set|enabled|true)\b/i, /\brpath\b(?!\s*:\s*(no|disabled|false|none))/i],
    [/\brpath\s*:\s*(no|disabled|false|none)\b/i]
  );

  const runpath = detectChecksecBoolean(
    normalized,
    [/\brunpath\s*:\s*(yes|set|enabled|true)\b/i, /\brunpath\b(?!\s*:\s*(no|disabled|false|none))/i],
    [/\brunpath\s*:\s*(no|disabled|false|none)\b/i]
  );

  const fortify = detectChecksecBoolean(
    normalized,
    [/\bfortify\s*:\s*(yes|enabled|true)\b/i, /\bfortified\b/i],
    [/\bfortify\s*:\s*(no|disabled|false)\b/i, /\bnot\s+fortified\b/i]
  );

  const stripped = detectChecksecBoolean(
    normalized,
    [/\bstripped\s*:\s*(yes|true)\b/i, /\bstripped\b/i],
    [/\bstripped\s*:\s*(no|false)\b/i, /\bnot\s+stripped\b/i]
  );

  return {
    relro,
    canary,
    nx,
    pie,
    rpath,
    runpath,
    fortify,
    stripped,
  };
}

/**
 * Generate a ROPgadget command with optional depth and filter.
 */
export function ropgadgetCommand(binaryPath: string, options?: { depth?: number; filter?: string }): ToolCommand {
  const parts: string[] = ["ROPgadget", `--binary ${shellQuote(binaryPath)}`];

  if (typeof options?.depth === "number") {
    parts.push(`--depth ${clamp(options.depth, MIN_ROP_DEPTH, MAX_ROP_DEPTH)}`);
  }

  const filter = options?.filter?.trim();
  if (filter) {
    parts.push(`--only ${shellQuote(filter)}`);
  }

  return {
    tool: "ROPgadget",
    command: parts.join(" "),
    purpose: "Discover usable ROP gadgets",
    outputParser: "ropgadget_summary_regex",
  };
}

/**
 * Generate a one_gadget command against a target libc.
 */
export function oneGadgetCommand(libcPath: string): ToolCommand {
  return {
    tool: "one_gadget",
    command: `one_gadget --raw ${shellQuote(libcPath)}`,
    purpose: "Enumerate one-shot libc gadget offsets",
    outputParser: "one_gadget_offset_regex",
  };
}

/**
 * Generate a binwalk command and optional extraction.
 */
export function binwalkCommand(filePath: string, extract: boolean = false): ToolCommand {
  return {
    tool: "binwalk",
    command: `binwalk${extract ? " -e" : ""} ${shellQuote(filePath)}`,
    purpose: extract ? "Scan and extract embedded data" : "Scan for embedded file signatures",
    outputParser: "binwalk_signature_regex",
  };
}

/**
 * Generate an exiftool command for metadata extraction.
 */
export function exiftoolCommand(filePath: string): ToolCommand {
  return {
    tool: "exiftool",
    command: `exiftool ${shellQuote(filePath)}`,
    purpose: "Extract artifact metadata",
    outputParser: "exif_key_value_regex",
  };
}

/**
 * Generate a nuclei command with bounded rate-limit for safer bounty workflows.
 */
export function nucleiCommand(
  target: string,
  options?: { templates?: string; rateLimit?: number; severity?: string }
): ToolCommand {
  const rateLimit = clamp(
    options?.rateLimit ?? DEFAULT_NUCLEI_RATE_LIMIT,
    MIN_NUCLEI_RATE_LIMIT,
    MAX_NUCLEI_RATE_LIMIT
  );
  const parts: string[] = [
    "nuclei",
    `-u ${shellQuote(target)}`,
    "-silent",
    "-no-color",
    `-rate-limit ${rateLimit}`,
  ];

  const templates = options?.templates?.trim();
  if (templates) {
    parts.push(`-t ${shellQuote(templates)}`);
  }

  const severity = uniqStrings(
    (options?.severity ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^(info|low|medium|high|critical|unknown)$/.test(item))
  ).join(",");
  if (severity) {
    parts.push(`-severity ${shellQuote(severity)}`);
  }

  return {
    tool: "nuclei",
    command: parts.join(" "),
    purpose: "Run template vulnerability checks with safety bounds",
    outputParser: "nuclei_finding_regex",
  };
}

/**
 * Generate an RsaCtfTool command from key components or a public key file.
 */
export function rsactftoolCommand(options: { n?: string; e?: string; c?: string; publicKey?: string }): ToolCommand {
  const parts: string[] = ["RsaCtfTool", "--private"];

  const publicKey = options.publicKey?.trim();
  if (publicKey) {
    parts.push(`--publickey ${shellQuote(publicKey)}`);
  } else {
    const n = options.n?.trim();
    const e = options.e?.trim();
    const c = options.c?.trim();

    if (n) {
      parts.push(`--n ${shellQuote(n)}`);
    }
    if (e) {
      parts.push(`--e ${shellQuote(e)}`);
    }
    if (c) {
      parts.push(`--uncipher ${shellQuote(c)}`);
    }
  }

  if (parts.length === 2) {
    parts.push("--help");
  }

  return {
    tool: "RsaCtfTool",
    command: parts.join(" "),
    purpose: "Attempt RSA key recovery/decryption",
    outputParser: "rsactftool_key_material_regex",
  };
}

/**
 * Build a minimal Python z3 solver template for provided constraints.
 */
export function z3SolverTemplate(constraints: string[]): string {
  const sanitized = constraints
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/\r?\n/g, " "));

  const lines: string[] = [
    "#!/usr/bin/env python3",
    "from z3 import *",
    "",
    "# Define your symbols first, for example:",
    "# x = BitVec('x', 32)",
    "s = Solver()",
  ];

  if (sanitized.length === 0) {
    lines.push("# TODO: s.add(<constraint>)");
  } else {
    for (const constraint of sanitized) {
      lines.push(`s.add(${constraint})`);
    }
  }

  lines.push(
    "",
    "if s.check() == sat:",
    "    print('sat')",
    "    print(s.model())",
    "else:",
    "    print('unsat')"
  );

  return lines.join("\n");
}

/**
 * Generate patchelf command sequence to align binary libc/ld linkage.
 */
export function patchelfCommand(binaryPath: string, libcPath: string, ldPath?: string): ToolCommand {
  const steps: string[] = [];
  const cleanLdPath = ldPath?.trim();

  if (cleanLdPath) {
    steps.push(`patchelf --set-interpreter ${shellQuote(cleanLdPath)} ${shellQuote(binaryPath)}`);
  }
  steps.push(`patchelf --replace-needed libc.so.6 ${shellQuote(libcPath)} ${shellQuote(binaryPath)}`);

  return {
    tool: "patchelf",
    command: steps.join(" && "),
    purpose: "Patch binary to match remote libc/loader",
    outputParser: "patchelf_exit_status",
  };
}

/**
 * Build compact prompt-ready summary text from tool results.
 */
export function buildToolSummary(results: ToolResult[]): string {
  if (!Array.isArray(results) || results.length === 0) {
    return "No tool results available.";
  }

  const successCount = results.filter((result) => result.success).length;
  const lines = [`Tool execution summary: ${successCount}/${results.length} succeeded.`];

  for (const result of results) {
    const status = result.success ? "OK" : "FAIL";
    const parsedKeyCount = Object.keys(result.parsed ?? {}).length;
    const summary = result.summary?.trim() || "No summary provided.";
    lines.push(`- [${status}] ${result.tool}: ${summary} (parsed_keys=${parsedKeyCount})`);
  }

  return lines.join("\n");
}

/**
 * Return recommended starter tools for a target type.
 */
export function recommendedTools(targetType: TargetType): ToolCommand[] {
  switch (targetType) {
    case "PWN":
      return [
        checksecCommand("<binary>"),
        ropgadgetCommand("<binary>", { depth: 12, filter: "pop|ret|syscall" }),
        oneGadgetCommand("<libc.so.6>"),
        patchelfCommand("<binary>", "<libc.so.6>", "<ld-linux-x86-64.so.2>"),
      ];
    case "REV":
      return [checksecCommand("<binary>"), binwalkCommand("<artifact>", true), exiftoolCommand("<artifact>")];
    case "CRYPTO":
      return [
        rsactftoolCommand({ n: "<n>", e: "<e>", c: "<ciphertext>" }),
        {
          tool: "z3",
          command: "python3 solve.py",
          purpose: "Run symbolic solver constraints",
          outputParser: "z3_sat_unsat_regex",
        },
      ];
    case "WEB_API":
      return [
        nucleiCommand("<target>", { rateLimit: DEFAULT_NUCLEI_RATE_LIMIT }),
        { tool: "sqlmap", command: "sqlmap -u '<target_url>' --batch --level=2 --risk=1", purpose: "Automated SQL injection detection", outputParser: "sqlmap_result_regex" },
        { tool: "curl", command: "curl -v '<target_url>'", purpose: "Inspect HTTP headers and response", outputParser: "curl_header_regex" },
        { tool: "ffuf", command: "ffuf -u '<target_url>/FUZZ' -w /usr/share/seclists/Discovery/Web-Content/common.txt -mc 200,301,302,403 -t 10", purpose: "Content discovery with rate limiting", outputParser: "ffuf_result_regex" },
        { tool: "jwt_tool", command: "jwt_tool '<jwt_token>' -a", purpose: "JWT analysis and attack enumeration", outputParser: "jwt_tool_regex" },
      ];
    case "WEB3":
      return [
        nucleiCommand("<target>", { rateLimit: DEFAULT_NUCLEI_RATE_LIMIT }),
        { tool: "slither", command: "slither '<contract.sol>'", purpose: "Solidity static vulnerability analysis", outputParser: "slither_finding_regex" },
        { tool: "forge", command: "forge test -vvv", purpose: "Run Foundry test suite with verbose output", outputParser: "forge_test_regex" },
        { tool: "cast", command: "cast call '<contract_address>' 'balanceOf(address)' '<address>'", purpose: "Read contract state", outputParser: "cast_output_regex" },
      ];
    case "FORENSICS":
      return [
        binwalkCommand("<image_or_dump>", true),
        exiftoolCommand("<image_or_media>"),
        { tool: "volatility3", command: "vol -f '<memory_dump>' windows.info", purpose: "Memory dump analysis", outputParser: "vol_result_regex" },
        { tool: "foremost", command: "foremost -i '<disk_image>' -o output/", purpose: "File carving from disk/memory image", outputParser: "foremost_audit_regex" },
        { tool: "tshark", command: "tshark -r '<pcap>' -q -z io,phs", purpose: "PCAP protocol hierarchy analysis", outputParser: "tshark_phs_regex" },
      ];
    case "MISC":
    case "UNKNOWN":
    default:
      return [
        binwalkCommand("<target>"),
        exiftoolCommand("<target>"),
        { tool: "zsteg", command: "zsteg '<image.png>'", purpose: "PNG steganography detection", outputParser: "zsteg_result_regex" },
        { tool: "steghide", command: "steghide info '<image.jpg>'", purpose: "JPEG steganography detection", outputParser: "steghide_info_regex" },
      ];
  }
}
