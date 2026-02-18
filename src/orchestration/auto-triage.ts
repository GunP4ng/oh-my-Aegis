import type { TargetType } from "../state/types";

export interface TriageCommand {
  tool: string;
  command: string;
  purpose: string;
  phase: number;
}

export interface TriageResult {
  filePath: string;
  detectedType: string;
  suggestedTarget: TargetType;
  commands: TriageCommand[];
  summary: string;
}

const EXTENSION_HINTS: Array<{ extensions: string[]; detectedType: string }> = [
  { extensions: [".elf", ".so", ".o", ".out", ".bin"], detectedType: "elf" },
  { extensions: [".zip", ".tar", ".tgz", ".gz", ".bz2", ".xz", ".7z", ".rar"], detectedType: "archive" },
  { extensions: [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff"], detectedType: "image" },
  { extensions: [".pcap", ".pcapng", ".cap"], detectedType: "pcap" },
  { extensions: [".pdf"], detectedType: "pdf" },
  { extensions: [".html", ".htm", ".json", ".xml", ".yaml", ".yml"], detectedType: "web" },
  {
    extensions: [".sh", ".py", ".rb", ".pl", ".php", ".js", ".ts", ".lua", ".ps1"],
    detectedType: "script",
  },
];

const FILE_OUTPUT_HINTS: Array<{ pattern: RegExp; detectedType: string }> = [
  { pattern: /\belf\b/i, detectedType: "elf" },
  {
    pattern: /\b(zip archive|tar archive|gzip compressed|bzip2 compressed|xz compressed|7-zip|rar archive)\b/i,
    detectedType: "archive",
  },
  {
    pattern: /\b(png image|jpeg image|gif image|bitmap|tiff image|webp image|svg image)\b/i,
    detectedType: "image",
  },
  { pattern: /\b(pcap|capture file)\b/i, detectedType: "pcap" },
  { pattern: /\bpdf document\b/i, detectedType: "pdf" },
  {
    pattern: /\b(shell script|python script|perl script|ruby script|php script|javascript source|typescript source)\b/i,
    detectedType: "script",
  },
  { pattern: /\b(html document|json data|xml document)\b/i, detectedType: "web" },
];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizedExtension(filePath: string): string {
  const lower = filePath.trim().toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return ".tgz";
  }
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

/**
 * Detect file type from extension and optional `file` command output.
 */
export function detectFileType(filePath: string, fileOutput?: string): string {
  const output = fileOutput ?? "";
  for (const hint of FILE_OUTPUT_HINTS) {
    if (hint.pattern.test(output)) {
      return hint.detectedType;
    }
  }

  const ext = normalizedExtension(filePath);
  for (const hint of EXTENSION_HINTS) {
    if (hint.extensions.includes(ext)) {
      return hint.detectedType;
    }
  }

  if (/^https?:\/\//i.test(filePath.trim())) {
    return "web";
  }

  return "unknown";
}

/**
 * Map detected file type to suggested orchestration target.
 */
export function suggestTarget(detectedType: string): TargetType {
  switch (detectedType) {
    case "elf":
      return "PWN";
    case "web":
      return "WEB_API";
    case "archive":
    case "image":
    case "pcap":
    case "pdf":
      return "FORENSICS";
    case "script":
      return "MISC";
    default:
      return "UNKNOWN";
  }
}

/**
 * Generate triage commands for a file based on detected type.
 */
export function generateTriageCommands(filePath: string, detectedType: string): TriageCommand[] {
  const quoted = shellQuote(filePath);
  const ext = normalizedExtension(filePath);

  if (detectedType === "elf") {
    return [
      { tool: "file", command: `file ${quoted}`, purpose: "Confirm binary format", phase: 1 },
      {
        tool: "checksec",
        command: `checksec --file=${quoted}`,
        purpose: "Inspect binary mitigations",
        phase: 1,
      },
      { tool: "readelf", command: `readelf -h ${quoted}`, purpose: "Inspect ELF headers", phase: 1 },
      {
        tool: "strings",
        command: `strings ${quoted} | grep -iE "flag|CTF" | head -20`,
        purpose: "Find CTF indicators quickly",
        phase: 1,
      },
      { tool: "ldd", command: `ldd ${quoted}`, purpose: "Inspect linked libraries", phase: 2 },
    ];
  }

  if (detectedType === "archive") {
    const commands: TriageCommand[] = [
      { tool: "file", command: `file ${quoted}`, purpose: "Confirm archive container", phase: 1 },
      { tool: "binwalk", command: `binwalk ${quoted}`, purpose: "Detect embedded content", phase: 1 },
      { tool: "7z", command: `7z l ${quoted}`, purpose: "List archive entries", phase: 1 },
    ];

    if (ext === ".zip") {
      commands.push({ tool: "unzip", command: `unzip -l ${quoted}`, purpose: "List ZIP members", phase: 1 });
    } else {
      commands.push({ tool: "tar", command: `tar -tf ${quoted}`, purpose: "List TAR-like members", phase: 1 });
    }

    return commands;
  }

  if (detectedType === "image") {
    const commands: TriageCommand[] = [
      { tool: "file", command: `file ${quoted}`, purpose: "Confirm image encoding", phase: 1 },
      { tool: "exiftool", command: `exiftool ${quoted}`, purpose: "Extract metadata", phase: 1 },
      { tool: "binwalk", command: `binwalk ${quoted}`, purpose: "Scan for embedded files", phase: 1 },
      { tool: "strings", command: `strings ${quoted} | head -20`, purpose: "Preview readable strings", phase: 1 },
    ];
    if (ext === ".png") {
      commands.push({ tool: "zsteg", command: `zsteg ${quoted}`, purpose: "Probe PNG steganography", phase: 2 });
    }
    return commands;
  }

  if (detectedType === "pcap") {
    return [
      { tool: "file", command: `file ${quoted}`, purpose: "Confirm capture file format", phase: 1 },
      {
        tool: "tshark",
        command: `tshark -r ${quoted} -q -z io,phs`,
        purpose: "Protocol hierarchy summary",
        phase: 1,
      },
      {
        tool: "tshark",
        command: `tshark -r ${quoted} -T fields -e frame.protocols | sort -u`,
        purpose: "List unique protocol stacks",
        phase: 1,
      },
    ];
  }

  if (detectedType === "pdf") {
    return [
      { tool: "file", command: `file ${quoted}`, purpose: "Confirm PDF document", phase: 1 },
      { tool: "exiftool", command: `exiftool ${quoted}`, purpose: "Extract metadata", phase: 1 },
      {
        tool: "strings",
        command: `strings ${quoted} | grep -i flag | head -10`,
        purpose: "Find likely flag strings",
        phase: 1,
      },
    ];
  }

  if (detectedType === "script" || detectedType === "web") {
    return [
      { tool: "file", command: `file ${quoted}`, purpose: "Confirm text/script type", phase: 1 },
      { tool: "head", command: `head -50 ${quoted}`, purpose: "Inspect top-of-file logic", phase: 1 },
      { tool: "wc", command: `wc -l ${quoted}`, purpose: "Estimate content size", phase: 1 },
    ];
  }

  return [
    { tool: "file", command: `file ${quoted}`, purpose: "Baseline type identification", phase: 1 },
    { tool: "xxd", command: `xxd ${quoted} | head -5`, purpose: "Inspect leading bytes", phase: 1 },
    { tool: "strings", command: `strings ${quoted} | head -20`, purpose: "Preview readable strings", phase: 1 },
  ];
}

/**
 * Run full triage pipeline for a single file.
 */
export function triageFile(filePath: string, fileOutput?: string): TriageResult {
  const detectedType = detectFileType(filePath, fileOutput);
  const suggestedTarget = suggestTarget(detectedType);
  const commands = generateTriageCommands(filePath, detectedType);
  const immediateCount = commands.filter((command) => command.phase === 1).length;
  const conditionalCount = commands.length - immediateCount;
  const summary = [
    `File: ${filePath}`,
    `Detected type: ${detectedType}`,
    `Suggested target: ${suggestedTarget}`,
    `Commands: ${immediateCount} immediate${conditionalCount > 0 ? `, ${conditionalCount} conditional` : ""}`,
  ].join("\n");

  return {
    filePath,
    detectedType,
    suggestedTarget,
    commands,
    summary,
  };
}

/**
 * Build prompt injection text from triage results.
 */
export function buildTriageSummary(results: TriageResult[]): string {
  if (results.length === 0) {
    return "Auto-triage summary: no inputs.";
  }

  const lines: string[] = ["Auto-triage summary:"];
  for (const result of results) {
    const immediateTools = result.commands
      .filter((command) => command.phase === 1)
      .map((command) => command.tool)
      .join(", ");
    const conditionalTools = result.commands
      .filter((command) => command.phase === 2)
      .map((command) => command.tool)
      .join(", ");

    lines.push(`- ${result.filePath}`);
    lines.push(`  Type=${result.detectedType} Target=${result.suggestedTarget}`);
    lines.push(`  Immediate=${immediateTools || "none"} Conditional=${conditionalTools || "none"}`);
  }

  return lines.join("\n");
}
