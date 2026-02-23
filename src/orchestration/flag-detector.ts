export interface FlagCandidate {
  flag: string;
  format: string;
  source: string;
  confidence: "high" | "medium" | "low";
  timestamp: number;
}

const DEFAULT_FLAG_PATTERNS: RegExp[] = [
  /flag\{[^}]{1,200}\}/gi,
  /CTF\{[^}]{1,200}\}/gi,
  /picoCTF\{[^}]{1,200}\}/gi,
  /htb\{[^}]{1,200}\}/gi,
  /TCTF\{[^}]{1,200}\}/gi,
  /SECCON\{[^}]{1,200}\}/gi,
  /ASIS\{[^}]{1,200}\}/gi,
  /CCTF\{[^}]{1,200}\}/gi,
  /hxp\{[^}]{1,200}\}/gi,
  /PCTF\{[^}]{1,200}\}/gi,
  /dice\{[^}]{1,200}\}/gi,
  /uiuctf\{[^}]{1,200}\}/gi,
  /ictf\{[^}]{1,200}\}/gi,
  /actf\{[^}]{1,200}\}/gi,
  /zer0pts\{[^}]{1,200}\}/gi,
];

const candidates: FlagCandidate[] = [];

let customPattern: RegExp | null = null;

const FAKE_PLACEHOLDER_RE =
  /(?:fake|placeholder|example|sample|dummy|mock|test[_-]?flag|not[_-]?real|decoy)/i;

function cloneAsGlobalRegex(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function confidenceForFlag(flag: string): FlagCandidate["confidence"] {
  const trimmed = flag.trim();
  if (!trimmed || trimmed.length < 6 || trimmed.length > 220) {
    return "low";
  }
  const openBrace = trimmed.indexOf("{");
  const payload = openBrace >= 0 && trimmed.endsWith("}") ? trimmed.slice(openBrace + 1, -1) : trimmed;
  if (FAKE_PLACEHOLDER_RE.test(payload)) {
    return "low";
  }
  const hasWhitespace = /\s/.test(trimmed);
  const hasBalancedBraces = trimmed.includes("{") && trimmed.endsWith("}");
  if (hasBalancedBraces && !hasWhitespace) {
    return "high";
  }
  if (hasBalancedBraces) {
    return "medium";
  }
  return "low";
}

function inferFormat(flag: string): string {
  const openBrace = flag.indexOf("{");
  if (openBrace <= 0) {
    return "unknown";
  }
  return `${flag.slice(0, openBrace)}{...}`;
}

function dedupe(items: FlagCandidate[]): FlagCandidate[] {
  const seen = new Set<string>();
  const output: FlagCandidate[] = [];
  for (const item of items) {
    const key = `${item.flag}|${item.source}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

/**
 * Set a custom flag regex for the current session.
 *
 * Passing an empty string clears the custom pattern.
 */
export function setCustomFlagPattern(pattern: string): void {
  const normalized = pattern.trim();
  if (!normalized) {
    customPattern = null;
    return;
  }
  try {
    customPattern = new RegExp(normalized, "gi");
  } catch {
    throw new Error(`Invalid custom flag pattern: ${pattern}`);
  }
}

/**
 * Scan text for known or custom flag patterns.
 */
export function scanForFlags(text: string, source: string): FlagCandidate[] {
  const safeText = text ?? "";
  if (!safeText) {
    return [];
  }

  const safeSource = source.trim() || "unknown";
  const now = Date.now();
  const patterns = customPattern ? [customPattern, ...DEFAULT_FLAG_PATTERNS] : DEFAULT_FLAG_PATTERNS;
  const found: FlagCandidate[] = [];

  for (const pattern of patterns) {
    const globalRegex = cloneAsGlobalRegex(pattern);
    const matches = safeText.matchAll(globalRegex);
    for (const match of matches) {
      const raw = match[0]?.trim() ?? "";
      if (!raw) {
        continue;
      }
      found.push({
        flag: raw,
        format: inferFormat(raw),
        source: safeSource,
        confidence: confidenceForFlag(raw),
        timestamp: now,
      });
    }
  }

  const uniqueFound = dedupe(found);
  if (uniqueFound.length === 0) {
    return [];
  }

  const existingKeys = new Set(candidates.map((c) => `${c.flag}|${c.source}`));
  for (const candidate of uniqueFound) {
    const key = `${candidate.flag}|${candidate.source}`;
    if (existingKeys.has(key)) {
      continue;
    }
    candidates.push(candidate);
    existingKeys.add(key);
  }

  return uniqueFound;
}

/**
 * Get all accumulated flag candidates.
 */
export function getCandidates(): FlagCandidate[] {
  return [...candidates].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Clear all accumulated flag candidates.
 */
export function clearCandidates(): void {
  candidates.length = 0;
}

/**
 * Build an alert block for prompt injection when candidates are found.
 */
export function buildFlagAlert(flagCandidates: FlagCandidate[]): string {
  if (!flagCandidates || flagCandidates.length === 0) {
    return "";
  }

  const lines = [
    `Potential flags detected (${flagCandidates.length}):`,
    "Treat these as CANDIDATES until official verifier confirms Correct/Accepted.",
  ];

  for (const candidate of flagCandidates) {
    lines.push(
      `- ${candidate.flag} | format=${candidate.format} | confidence=${candidate.confidence} | source=${candidate.source}`
    );
  }

  return lines.join("\n");
}

/**
 * Fast boolean check for likely flag patterns.
 */
export function containsFlag(text: string): boolean {
  const safeText = text ?? "";
  if (!safeText) {
    return false;
  }
  const patterns = customPattern ? [customPattern, ...DEFAULT_FLAG_PATTERNS] : DEFAULT_FLAG_PATTERNS;
  return patterns.some((pattern) => cloneAsGlobalRegex(pattern).test(safeText));
}
