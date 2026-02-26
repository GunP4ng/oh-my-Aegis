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

export class FlagDetectorStore {
  private candidates: FlagCandidate[] = [];
  private customPattern: RegExp | null = null;

  setCustomFlagPattern(pattern: string): void {
    const normalized = pattern.trim();
    if (!normalized) {
      this.customPattern = null;
      return;
    }
    try {
      this.customPattern = new RegExp(normalized, "gi");
    } catch {
      throw new Error(`Invalid custom flag pattern: ${pattern}`);
    }
  }

  private getPatterns(): RegExp[] {
    return this.customPattern ? [this.customPattern, ...DEFAULT_FLAG_PATTERNS] : DEFAULT_FLAG_PATTERNS;
  }

  scanForFlags(text: string, source: string): FlagCandidate[] {
    const safeText = text ?? "";
    if (!safeText) {
      return [];
    }

    const safeSource = source.trim() || "unknown";
    const now = Date.now();
    const patterns = this.getPatterns();
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

    const existingKeys = new Set(this.candidates.map((c) => `${c.flag}|${c.source}`));
    for (const candidate of uniqueFound) {
      const key = `${candidate.flag}|${candidate.source}`;
      if (existingKeys.has(key)) {
        continue;
      }
      this.candidates.push(candidate);
      existingKeys.add(key);
    }

    return uniqueFound;
  }

  getCandidates(): FlagCandidate[] {
    return [...this.candidates].sort((a, b) => b.timestamp - a.timestamp);
  }

  clearCandidates(): void {
    this.candidates.length = 0;
  }

  containsFlag(text: string): boolean {
    const safeText = text ?? "";
    if (!safeText) {
      return false;
    }
    const patterns = this.getPatterns();
    return patterns.some((pattern) => cloneAsGlobalRegex(pattern).test(safeText));
  }
}

// ── Backward-compatible module-level functions using a default store ──

const defaultStore = new FlagDetectorStore();

export function setCustomFlagPattern(pattern: string): void {
  defaultStore.setCustomFlagPattern(pattern);
}

export function scanForFlags(text: string, source: string): FlagCandidate[] {
  return defaultStore.scanForFlags(text, source);
}

export function getCandidates(): FlagCandidate[] {
  return defaultStore.getCandidates();
}

export function clearCandidates(): void {
  defaultStore.clearCandidates();
}

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

export function containsFlag(text: string): boolean {
  return defaultStore.containsFlag(text);
}

// ─── Decoy Guard ───

const DECOY_KEYWORDS_RE =
  /\b(fake|decoy|dummy|placeholder|not[_-]?real|wrong|sample|example|FAKE_FLAG)\b/i;

export interface DecoyCheckResult {
  isDecoySuspect: boolean;
  reason: string;
  decoyCandidates: FlagCandidate[];
}

/**
 * Check if detected flag candidates are likely decoys.
 * Triggers DECOY_SUSPECT when:
 *  1) Flag candidate found + oracle rejected it
 *  2) Flag content matches known decoy keywords
 *  3) Multiple candidates with low confidence
 */
export function checkForDecoy(
  candidates: FlagCandidate[],
  oraclePassed: boolean,
): DecoyCheckResult {
  if (candidates.length === 0) {
    return { isDecoySuspect: false, reason: "", decoyCandidates: [] };
  }

  const decoyCandidates = candidates.filter((c) =>
    DECOY_KEYWORDS_RE.test(c.flag) || c.confidence === "low",
  );

  if (decoyCandidates.length > 0 && !oraclePassed) {
    return {
      isDecoySuspect: true,
      reason: `Flag(s) contain decoy keywords (${decoyCandidates.map((c) => c.flag).join(", ")}) and oracle rejected`,
      decoyCandidates,
    };
  }

  if (!oraclePassed && candidates.length > 0) {
    return {
      isDecoySuspect: true,
      reason: `Flag candidate(s) found but oracle rejected — possible decoy path`,
      decoyCandidates: candidates,
    };
  }

  return { isDecoySuspect: false, reason: "", decoyCandidates: [] };
}

// ─── Replay Safety Rule ───

const REPLAY_UNSAFE_INDICATORS = [
  "memfd_create",
  "fexecve",
  "mmap",
  "MAP_ANONYMOUS",
  ".rela.p",
  ".sym.p",
  "process_vm_readv",
  "ptrace",
];

/**
 * Detect if a binary likely uses memfd/relocation tricks that make
 * standalone re-execution unreliable.
 */
export function isReplayUnsafe(
  stringsOutput?: string,
  readelfOutput?: string,
): { unsafe: boolean; signals: string[] } {
  const signals: string[] = [];
  const combined = `${stringsOutput ?? ""}\n${readelfOutput ?? ""}`;

  for (const indicator of REPLAY_UNSAFE_INDICATORS) {
    if (combined.includes(indicator)) {
      signals.push(indicator);
    }
  }

  return {
    unsafe: signals.length >= 2,
    signals,
  };
}
