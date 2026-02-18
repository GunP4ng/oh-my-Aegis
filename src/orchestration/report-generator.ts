import type { Mode } from "../state/types";

export interface ReportSection {
  title: string;
  content: string;
  artifacts?: string[];
}

export interface Report {
  mode: Mode;
  title: string;
  sections: ReportSection[];
  generatedAt: number;
  markdown: string;
}

function trimLine(line: string): string {
  return line.trim();
}

function stripListPrefix(line: string): string {
  return line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim();
}

function stripHeadingPrefix(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

function cleanupArtifactToken(value: string): string {
  return value.trim().replace(/^[<("']+/, "").replace(/[>)"',.;:]+$/, "");
}

function extractTimestamp(line: string): { timestamp?: string; rest: string } {
  const bracketed = line.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bracketed) {
    return {
      timestamp: bracketed[1].trim(),
      rest: bracketed[2].trim(),
    };
  }

  const isoLike = line.match(
    /^(\d{4}[-/]\d{2}[-/]\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\s*(?:UTC|KST|[A-Z]{2,5}|[+-]\d{2}:?\d{2}))?)?)\s*(?:[-:|])?\s*(.*)$/
  );
  if (isoLike) {
    return {
      timestamp: isoLike[1].trim(),
      rest: isoLike[2].trim(),
    };
  }

  const timeOnly = line.match(/^(\d{2}:\d{2}(?::\d{2})?)\s*(?:[-:|])?\s*(.*)$/);
  if (timeOnly) {
    return {
      timestamp: timeOnly[1].trim(),
      rest: timeOnly[2].trim(),
    };
  }

  return { rest: line };
}

function splitActionResult(line: string): { action: string; result: string } {
  const delimiters = ["=>", "->", "|"];
  for (const delimiter of delimiters) {
    const index = line.indexOf(delimiter);
    if (index > 0) {
      const action = line.slice(0, index).trim();
      const result = line.slice(index + delimiter.length).trim();
      return {
        action: action || "log",
        result: result || "not specified",
      };
    }
  }

  const keyValue = line.match(
    /^(?:action|tried|step)\s*:\s*(.+?)(?:\s+(?:result|observed|outcome|status)\s*:\s*(.+))?$/i
  );
  if (keyValue) {
    return {
      action: keyValue[1].trim(),
      result: keyValue[2]?.trim() || "not specified",
    };
  }

  const resultOnly = line.match(/^(?:result|observed|outcome|status)\s*:\s*(.+)$/i);
  if (resultOnly) {
    return {
      action: "observation",
      result: resultOnly[1].trim(),
    };
  }

  const embeddedResult = line.match(/^(.+?)\s+(?:result|observed|outcome|status)\s*:\s*(.+)$/i);
  if (embeddedResult) {
    return {
      action: embeddedResult[1].trim(),
      result: embeddedResult[2].trim(),
    };
  }

  return {
    action: line.trim() || "log",
    result: "not specified",
  };
}

function extractArtifactPaths(content: string): string[] {
  const artifacts = new Set<string>();

  const inlineCodePattern = /`([^`]+)`/g;
  for (const match of content.matchAll(inlineCodePattern)) {
    const candidate = cleanupArtifactToken(match[1]);
    if (/[/\\]/.test(candidate) || /\.[a-zA-Z0-9]{1,8}$/.test(candidate)) {
      artifacts.add(candidate);
    }
  }

  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of content.matchAll(markdownLinkPattern)) {
    const candidate = cleanupArtifactToken(match[1]);
    if (candidate) {
      artifacts.add(candidate);
    }
  }

  const pathPattern = /(?:^|\s)(\.?\/?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/g;
  for (const match of content.matchAll(pathPattern)) {
    const candidate = cleanupArtifactToken(match[1]);
    if (candidate && !/^https?:\/\//i.test(candidate)) {
      artifacts.add(candidate);
    }
  }

  return Array.from(artifacts);
}

function isEntryBoundary(line: string): boolean {
  return /^#{2,6}\s+/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line);
}

function finalizeEvidenceBlock(blockLines: string[]): { item: string; verification: string; artifacts: string[] } | null {
  const cleaned = blockLines.map((line) => trimLine(line)).filter(Boolean);
  if (cleaned.length === 0) {
    return null;
  }

  const firstLine = stripHeadingPrefix(stripListPrefix(cleaned[0]));
  const item = firstLine || "Evidence item";

  const verificationLine =
    cleaned
      .map((line) => stripHeadingPrefix(stripListPrefix(line)))
      .find((line) => /\b(verified|verification|status|result|accepted|correct|impact|severity)\b/i.test(line)) ??
    cleaned[1] ??
    "Verification details not specified.";

  return {
    item,
    verification: stripHeadingPrefix(stripListPrefix(verificationLine)),
    artifacts: extractArtifactPaths(cleaned.join("\n")),
  };
}

function buildReport(mode: Mode, title: string, sections: ReportSection[]): Report {
  const generatedAt = Date.now();
  const draft: Report = {
    mode,
    title,
    sections,
    generatedAt,
    markdown: "",
  };

  return {
    ...draft,
    markdown: formatReportMarkdown(draft),
  };
}

function renderWorklogEntries(entries: Array<{ timestamp: string; action: string; result: string }>, emptyFallback: string): string {
  if (entries.length === 0) {
    return emptyFallback;
  }

  return entries
    .map((entry, index) => `${index + 1}. [${entry.timestamp}] ${entry.action} -> ${entry.result}`)
    .join("\n");
}

function renderEvidenceEntries(
  entries: Array<{ item: string; verification: string; artifacts: string[] }>,
  emptyFallback: string
): string {
  if (entries.length === 0) {
    return emptyFallback;
  }

  return entries
    .map((entry) => {
      const artifactSuffix = entry.artifacts.length > 0 ? ` | artifacts: ${entry.artifacts.join(", ")}` : "";
      return `- ${entry.item}: ${entry.verification}${artifactSuffix}`;
    })
    .join("\n");
}

function inferFlag(optionsFlag: string | undefined, evidenceContent: string): string {
  const explicit = optionsFlag?.trim();
  if (explicit) {
    return explicit;
  }

  const detected = evidenceContent.match(/(?:flag\{|CTF\{|FLAG\{)[^\s}]+\}/);
  return detected?.[0] ?? "Not provided";
}

/**
 * Parse WORKLOG.md content into timestamp/action/result entries.
 */
export function parseWorklog(content: string): Array<{ timestamp: string; action: string; result: string }> {
  const lines = content.replace(/\r/g, "").split("\n");
  const entries: Array<{ timestamp: string; action: string; result: string }> = [];
  let currentTimestamp = "unknown";

  for (const rawLine of lines) {
    const cleaned = stripHeadingPrefix(stripListPrefix(trimLine(rawLine)));
    if (!cleaned) {
      continue;
    }

    const timestampParsed = extractTimestamp(cleaned);
    if (timestampParsed.timestamp) {
      currentTimestamp = timestampParsed.timestamp;
    }
    const body = (timestampParsed.rest || cleaned).trim();
    if (!body) {
      continue;
    }

    if (/^(goal|next\s*todo|todo|phase|lh|candidate|verified)\s*:/i.test(body)) {
      continue;
    }

    const split = splitActionResult(body);
    entries.push({
      timestamp: currentTimestamp,
      action: split.action,
      result: split.result,
    });
  }

  return entries;
}

/**
 * Parse EVIDENCE.md content into item/verification/artifact entries.
 */
export function parseEvidence(content: string): Array<{ item: string; verification: string; artifacts: string[] }> {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const rawLine of lines) {
    const trimmed = trimLine(rawLine);
    if (!trimmed) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
      continue;
    }

    if (isEntryBoundary(trimmed) && currentBlock.length > 0) {
      blocks.push(currentBlock);
      currentBlock = [trimmed];
    } else {
      currentBlock.push(trimmed);
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  if (blocks.length === 0 && content.trim()) {
    blocks.push(content.replace(/\r/g, "").split("\n").map((line) => trimLine(line)).filter(Boolean));
  }

  const entries: Array<{ item: string; verification: string; artifacts: string[] }> = [];
  for (const block of blocks) {
    const parsed = finalizeEvidenceBlock(block);
    if (parsed) {
      entries.push(parsed);
    }
  }

  return entries;
}

/**
 * Generate a CTF writeup from WORKLOG and EVIDENCE markdown sources.
 */
export function generateCtfWriteup(
  worklogContent: string,
  evidenceContent: string,
  options?: { challengeName?: string; category?: string; flag?: string }
): Report {
  const worklogEntries = parseWorklog(worklogContent);
  const evidenceEntries = parseEvidence(evidenceContent);
  const challengeName = options?.challengeName?.trim() || "CTF Challenge";
  const category = options?.category?.trim() || "Unknown";
  const finalFlag = inferFlag(options?.flag, evidenceContent);

  const sectionArtifacts = Array.from(new Set(evidenceEntries.flatMap((entry) => entry.artifacts)));

  const sections: ReportSection[] = [
    {
      title: "Challenge Overview",
      content: [
        `- Challenge: ${challengeName}`,
        `- Category: ${category}`,
        "- Mode: CTF",
        `- Worklog Entries: ${worklogEntries.length}`,
        `- Evidence Items: ${evidenceEntries.length}`,
      ].join("\n"),
    },
    {
      title: "Methodology",
      content: renderWorklogEntries(worklogEntries, "No structured worklog entries were found."),
    },
    {
      title: "Verification Evidence",
      content: renderEvidenceEntries(evidenceEntries, "No verification evidence entries were found."),
      artifacts: sectionArtifacts,
    },
    {
      title: "Final Flag",
      content: `- ${finalFlag}`,
    },
  ];

  return buildReport("CTF", `${challengeName} Writeup`, sections);
}

/**
 * Generate a bounty report from WORKLOG and EVIDENCE markdown sources.
 */
export function generateBountyReport(
  worklogContent: string,
  evidenceContent: string,
  options?: { programName?: string; severity?: string; endpoint?: string }
): Report {
  const worklogEntries = parseWorklog(worklogContent);
  const evidenceEntries = parseEvidence(evidenceContent);
  const programName = options?.programName?.trim() || "Target Program";
  const severity = options?.severity?.trim() || "Unspecified";
  const endpoint = options?.endpoint?.trim() || "Not specified";

  const artifacts = Array.from(new Set(evidenceEntries.flatMap((entry) => entry.artifacts)));

  const sections: ReportSection[] = [
    {
      title: "Executive Summary",
      content: [
        `- Program: ${programName}`,
        `- Reported Severity: ${severity}`,
        `- Affected Endpoint: ${endpoint}`,
        "- Mode: BOUNTY",
      ].join("\n"),
    },
    {
      title: "Steps to Reproduce",
      content: renderWorklogEntries(worklogEntries, "No reproducible steps were parsed from WORKLOG."),
    },
    {
      title: "Observed Evidence",
      content: renderEvidenceEntries(evidenceEntries, "No structured evidence entries were parsed from EVIDENCE."),
      artifacts,
    },
    {
      title: "Impact",
      content: [
        `- Claimed Severity: ${severity}`,
        "- Validate business impact with explicit authorization and reproducible minimal-impact proof.",
      ].join("\n"),
    },
    {
      title: "Remediation",
      content: [
        "1. Reproduce the issue in a controlled environment using the listed steps.",
        "2. Apply the least-privilege and input-validation control relevant to the root cause.",
        "3. Re-run the validation evidence checks and confirm the issue no longer reproduces.",
      ].join("\n"),
    },
  ];

  return buildReport("BOUNTY", `${programName} Security Report`, sections);
}

/**
 * Generate a mode-specific report from WORKLOG/EVIDENCE markdown content.
 */
export function generateReport(
  mode: Mode,
  worklogContent: string,
  evidenceContent: string,
  options?: Record<string, string>
): Report {
  if (mode === "CTF") {
    return generateCtfWriteup(worklogContent, evidenceContent, {
      challengeName: options?.challengeName,
      category: options?.category,
      flag: options?.flag,
    });
  }

  return generateBountyReport(worklogContent, evidenceContent, {
    programName: options?.programName,
    severity: options?.severity,
    endpoint: options?.endpoint,
  });
}

/**
 * Render a report object as markdown.
 */
export function formatReportMarkdown(report: Report): string {
  const lines: string[] = [
    `# ${report.title}`,
    "",
    `- Mode: ${report.mode}`,
    `- Generated At: ${new Date(report.generatedAt).toISOString()}`,
    "",
  ];

  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(section.content.trim() || "No content provided.");

    if (section.artifacts && section.artifacts.length > 0) {
      lines.push("");
      lines.push("Artifacts:");
      for (const artifact of section.artifacts) {
        lines.push(`- \`${artifact}\``);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
