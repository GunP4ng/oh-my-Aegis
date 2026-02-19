import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type BlackoutWindow = {
  day: number;
  startMinutes: number;
  endMinutes: number;
};

export type BountyScopePolicy = {
  sourcePath: string;
  sourceMtimeMs: number;
  allowedHostsExact: string[];
  allowedHostsSuffix: string[];
  deniedHostsExact: string[];
  deniedHostsSuffix: string[];
  blackoutWindows: BlackoutWindow[];
  warnings: string[];
};

export type ScopeDocLoadResult =
  | { ok: true; policy: BountyScopePolicy }
  | { ok: false; reason: string; warnings: string[] };

export type ScopeDocConfig = {
  candidates: string[];
  includeApexForWildcardAllow: boolean;
};

const DEFAULT_CANDIDATES = [
  ".Aegis/scope.md",
  ".opencode/bounty-scope.md",
  "BOUNTY_SCOPE.md",
  "SCOPE.md",
] as const;

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, "");
}

function parseHostToken(token: string):
  | { kind: "exact"; host: string }
  | { kind: "suffix"; suffix: string }
  | null {
  const raw = token.trim();
  if (!raw) return null;
  const withoutPunct = raw.replace(/^[`'"\[\(\{<]+|[`'"\]\)\}>.,;:]+$/g, "");
  if (!withoutPunct) return null;
  if (/^https?:\/\//i.test(withoutPunct)) {
    try {
      const u = new URL(withoutPunct);
      const h = normalizeHost(u.hostname);
      if (!h) return null;
      return { kind: "exact", host: h };
    } catch {
      return null;
    }
  }

  const wildcard = withoutPunct.match(/^\*\.(.+)$/);
  if (wildcard) {
    const suffix = normalizeHost(wildcard[1]);
    if (!suffix) return null;
    return { kind: "suffix", suffix };
  }

  const hostLike = withoutPunct.match(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i);
  if (!hostLike) return null;
  const host = normalizeHost(withoutPunct);
  return host ? { kind: "exact", host } : null;
}

function parseDayToIndex(text: string): number | null {
  const t = text.trim();
  if (t.includes("일")) return 0;
  if (t.includes("월")) return 1;
  if (t.includes("화")) return 2;
  if (t.includes("수")) return 3;
  if (t.includes("목")) return 4;
  if (t.includes("금")) return 5;
  if (t.includes("토")) return 6;
  if (/\bsun(day)?\b/i.test(t)) return 0;
  if (/\bmon(day)?\b/i.test(t)) return 1;
  if (/\btue(s|sday)?\b/i.test(t)) return 2;
  if (/\bwed(nesday)?\b/i.test(t)) return 3;
  if (/\bthu(r|rs|rsday)?\b/i.test(t)) return 4;
  if (/\bfri(day)?\b/i.test(t)) return 5;
  if (/\bsat(urday)?\b/i.test(t)) return 6;
  return null;
}

function parseTimeToMinutes(hhmm: string): number | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function parseBlackoutWindows(lines: string[]): { windows: BlackoutWindow[]; warnings: string[] } {
  const windows: BlackoutWindow[] = [];
  const warnings: string[] = [];

  const re = /(월|화|수|목|금|토|일|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*요일?\s*(\d{1,2}:\d{2})\s*[~\-]\s*(\d{1,2}:\d{2})/gi;

  for (const line of lines) {
    const matches = [...line.matchAll(re)];
    for (const match of matches) {
      const day = parseDayToIndex(match[1] ?? "");
      const start = parseTimeToMinutes(match[2] ?? "");
      const end = parseTimeToMinutes(match[3] ?? "");
      if (day === null || start === null || end === null) {
        warnings.push(`failed_to_parse_blackout: ${line.trim()}`);
        continue;
      }
      if (end >= start) {
        windows.push({ day, startMinutes: start, endMinutes: end });
        continue;
      }

      windows.push({ day, startMinutes: start, endMinutes: 1439 });
      windows.push({ day: (day + 1) % 7, startMinutes: 0, endMinutes: end });
    }
  }

  return { windows, warnings };
}

type SectionMode = "unknown" | "allow" | "deny";

function classifySection(line: string): SectionMode {
  if (/(범위\s*내|허용|테스트\s*가능|in\s*-?\s*scope|scope\s*in|eligible|authorized)/i.test(line)) {
    return "allow";
  }
  if (/(범위\s*외|비대상|제외|금지|out\s*-?\s*of\s*-?\s*scope|scope\s*out|exclude|excluded|prohibited|forbidden)/i.test(line)) {
    return "deny";
  }
  return "unknown";
}

function dedupeSorted(list: string[]): string[] {
  const out = [...new Set(list.filter(Boolean))];
  out.sort();
  return out;
}

export function parseScopeMarkdown(
  markdown: string,
  sourcePath: string,
  mtimeMs: number,
  options?: { includeApexForWildcardAllow?: boolean }
): BountyScopePolicy {
  const includeApexForWildcardAllow = options?.includeApexForWildcardAllow === true;
  const warnings: string[] = [];
  const lines = markdown.split(/\r?\n/);
  const { windows, warnings: blackoutWarnings } = parseBlackoutWindows(lines);
  warnings.push(...blackoutWarnings);

  const allowedHostsExact: string[] = [];
  const allowedHostsSuffix: string[] = [];
  const deniedHostsExact: string[] = [];
  const deniedHostsSuffix: string[] = [];

  let mode: SectionMode = "unknown";
  for (const line of lines) {
    const section = classifySection(line);
    if (section !== "unknown") {
      mode = section;
    }

    const tokens = line
      .split(/[\s|`]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    for (const token of tokens) {
      const parsed = parseHostToken(token);
      if (!parsed) continue;

      if (mode === "unknown") {
        continue;
      }
      const target = mode;
      if (parsed.kind === "exact") {
        if (target === "deny") deniedHostsExact.push(parsed.host);
        else allowedHostsExact.push(parsed.host);
      } else {
        if (target === "deny") deniedHostsSuffix.push(parsed.suffix);
        else {
          allowedHostsSuffix.push(parsed.suffix);
          if (includeApexForWildcardAllow) {
            allowedHostsExact.push(parsed.suffix);
          }
        }
      }
    }
  }

  for (const line of lines) {
    const m = line.match(/기준\s*도메인\s*:\s*([a-z0-9.-]+)\b/i);
    if (m) {
      const h = normalizeHost(m[1] ?? "");
      if (h) {
        allowedHostsExact.push(h);
      }
    }
  }

  return {
    sourcePath,
    sourceMtimeMs: mtimeMs,
    allowedHostsExact: dedupeSorted(allowedHostsExact),
    allowedHostsSuffix: dedupeSorted(allowedHostsSuffix),
    deniedHostsExact: dedupeSorted(deniedHostsExact),
    deniedHostsSuffix: dedupeSorted(deniedHostsSuffix),
    blackoutWindows: windows,
    warnings: dedupeSorted(warnings),
  };
}

export function resolveScopeDocCandidates(projectDir: string, config?: Partial<ScopeDocConfig>): string[] {
  const candidates = (config?.candidates?.length ? config.candidates : [...DEFAULT_CANDIDATES]) as string[];
  return candidates.map((p) => join(projectDir, p));
}

export function loadScopePolicyFromWorkspace(projectDir: string, config?: Partial<ScopeDocConfig>): ScopeDocLoadResult {
  const warnings: string[] = [];
  const candidates = resolveScopeDocCandidates(projectDir, config);
  let path: string | null = null;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      path = candidate;
      break;
    }
  }
  if (!path) {
    return {
      ok: false,
      reason: `No scope document found. Looked for: ${candidates.map((c) => c.replace(projectDir + "/", "")).join(", ")}`,
      warnings,
    };
  }

  let raw: string;
  let mtimeMs = 0;
  try {
    raw = readFileSync(path, "utf-8");
    mtimeMs = statSync(path).mtimeMs;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Failed to read scope document '${path}': ${message}`, warnings };
  }

  const policy = parseScopeMarkdown(raw, path, mtimeMs, {
    includeApexForWildcardAllow: config?.includeApexForWildcardAllow === true,
  });
  return { ok: true, policy };
}

export function hostMatchesPolicy(
  host: string,
  policy: Pick<
    BountyScopePolicy,
    "allowedHostsExact" | "allowedHostsSuffix" | "deniedHostsExact" | "deniedHostsSuffix"
  >
): { allowed: boolean; reason?: string } {
  const normalized = normalizeHost(host);
  if (!normalized) {
    return { allowed: false, reason: "empty_host" };
  }

  const deniedExact = new Set(policy.deniedHostsExact);
  const deniedSuffix = policy.deniedHostsSuffix;
  if (deniedExact.has(normalized)) {
    return { allowed: false, reason: `host_denied_exact:${normalized}` };
  }
  for (const suffix of deniedSuffix) {
    if (normalized === suffix || normalized.endsWith(`.${suffix}`)) {
      return { allowed: false, reason: `host_denied_suffix:${suffix}` };
    }
  }

  const allowedExact = new Set(policy.allowedHostsExact);
  const allowedSuffix = policy.allowedHostsSuffix;
  if (allowedExact.has(normalized)) {
    return { allowed: true };
  }
  for (const suffix of allowedSuffix) {
    if (normalized.endsWith(`.${suffix}`)) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: "host_not_in_allowlist" };
}

export function isInBlackout(now: Date, windows: BlackoutWindow[]): boolean {
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const w of windows) {
    if (w.day !== day) continue;
    if (w.startMinutes <= minutes && minutes <= w.endMinutes) return true;
  }
  return false;
}
