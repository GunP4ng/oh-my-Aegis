import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import type { DispatchPlan } from "./parallel";

export interface SubagentRequest {
  type: "explore" | "librarian";
  query: string;
  context?: string;
  background?: boolean;
}

export type SubagentDispatchConfigHint = Pick<OrchestratorConfig, "parallel">;

const MAX_TRACKS_HARD_CAP = 6;
const DEFAULT_EXPLORE_TRACKS = 3;
const DEFAULT_LIBRARIAN_TRACKS = 3;

const LIBRARIAN_HINTS = [
  "cve",
  "cwe",
  "nvd",
  "mitre",
  "advisory",
  "writeup",
  "documentation",
  "docs",
  "api",
  "reference",
  "github",
  "repo",
  "framework",
  "library",
  "exploit-db",
];

const EXPLORE_HINTS = [
  "file",
  "files",
  "source",
  "code",
  "codebase",
  "binary",
  "elf",
  "pcap",
  "trace",
  "function",
  "handler",
  "controller",
  "endpoint",
  "grep",
  "glob",
  "ast",
  "line",
  "sink",
  "challenge",
  "artifact",
];

function clampMaxTracks(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), MAX_TRACKS_HARD_CAP);
}

function cleanList(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  const dedup = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    dedup.add(value);
  }
  return [...dedup];
}

function compactQuery(query: string, fallback: string): string {
  const trimmed = query.trim();
  return trimmed ? trimmed : fallback;
}

function safeLabel(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "query";
}

function withOptionalContext(prompt: string, context?: string): string {
  const trimmed = context?.trim();
  if (!trimmed) {
    return prompt;
  }
  return `${prompt}\n\nAdditional context:\n${trimmed.slice(0, 1200)}`;
}

function withPromptContract(uniqueFocus: string, doNotCover: string, body: string[]): string {
  return [`UniqueFocus: ${uniqueFocus}`, `DoNotCover: ${doNotCover}`, ...body].join("\n");
}

type LibrarianSearchType = "cve" | "writeup" | "docs" | "github";

function countHints(haystack: string, needles: string[]): number {
  let score = 0;
  for (const hint of needles) {
    if (haystack.includes(hint)) {
      score += 1;
    }
  }
  return score;
}

function detectSearchTypes(query: string): LibrarianSearchType[] {
  const q = query.toLowerCase();
  const selected = new Set<LibrarianSearchType>();

  if (q.includes("cve") || q.includes("cwe") || q.includes("advisory") || q.includes("nvd")) {
    selected.add("cve");
  }
  if (q.includes("writeup") || q.includes("ctf") || q.includes("walkthrough")) {
    selected.add("writeup");
  }
  if (q.includes("docs") || q.includes("documentation") || q.includes("api") || q.includes("framework")) {
    selected.add("docs");
  }
  if (q.includes("github") || q.includes("repo") || q.includes("source")) {
    selected.add("github");
  }

  if (selected.size === 0) {
    return ["cve", "writeup", "docs"];
  }

  return [...selected];
}

function buildExploreTracks(
  state: SessionState,
  query: string,
  focusAreas: string[]
): DispatchPlan["tracks"] {
  const modeHint =
    state.mode === "CTF"
      ? "CTF mode: challenge-centric artifact and binary/code attack-surface discovery."
      : "BOUNTY mode: codebase-centric vulnerability pattern review with minimal-impact assumptions.";

  const focusHint =
    focusAreas.length > 0
      ? `Prioritize these focus areas: ${focusAreas.join(", ")}.`
      : "Prioritize likely hot spots: inputs, trust boundaries, auth/session, parsing, deserialization, command/file/network sinks.";

  return [
    {
      purpose: "aegis-explore-surface-map",
      agent: "aegis-explore",
      prompt: withPromptContract(
        "surface map: file list, entrypoints, protections, top hotspots",
        "Do not cover aegis-explore-vuln-patterns (vuln-patterns) or aegis-explore-evidence-cut (evidence-cut); forbid deep sink analysis and ranking/triage summarization.",
        [
          "[Aegis Subagent Dispatch: Explore / Surface Map]",
          `Query: ${query}`,
          modeHint,
          focusHint,
          "Use grep/glob/read/ast_grep_search to map attack surface quickly.",
          "Output <=20 bullet lines with file:line references.",
        ]
      ),
    },
    {
      purpose: "aegis-explore-vuln-patterns",
      agent: "aegis-explore",
      prompt: withPromptContract(
        "security patterns: sinks, trust boundaries, validation/authz/authn issues",
        "Do not cover aegis-explore-surface-map (surface-map) or aegis-explore-evidence-cut (evidence-cut); forbid broad inventory and ranking/triage summarization.",
        [
          "[Aegis Subagent Dispatch: Explore / Vulnerability Patterns]",
          `Query: ${query}`,
          "Search for security-relevant patterns: weak validation, trust-boundary gaps, dangerous sinks, parser misuse, crypto misuse, authz/authn mistakes.",
          "Use targeted grep and AST pattern search only.",
          "Output <=20 bullet lines with file:line references.",
        ]
      ),
    },
    {
      purpose: "aegis-explore-evidence-cut",
      agent: "aegis-explore",
      prompt: withPromptContract(
        "evidence cut: dedupe + rank findings by exploitability/confidence + top 5",
        "Do not cover aegis-explore-surface-map (surface-map) or aegis-explore-vuln-patterns (vuln-patterns); forbid new searching and only synthesize existing findings.",
        [
          "[Aegis Subagent Dispatch: Explore / Evidence Cut]",
          `Query: ${query}`,
          "Collect the highest-signal findings only and reduce noise.",
          "Rank findings by exploitability and confidence.",
          "Output <=20 bullet lines with file:line references.",
        ]
      ),
    },
  ];
}

function buildLibrarianPrompt(type: LibrarianSearchType, query: string): string {
  if (type === "cve") {
    return withPromptContract(
      "cve intelligence: CVEs, advisories, and applicability to the query",
      "Do not cover writeup/docs/github librarian tracks; do not perform local code exploration.",
      [
        "[Aegis Subagent Dispatch: Librarian / CVE Intelligence]",
        `Query: ${query}`,
        "Find CVEs/advisories relevant to this query.",
        "Prefer NVD, vendor advisories, and high-quality writeups.",
        "Return 3-5 references with URL and 1-2 line applicability summary.",
      ]
    );
  }

  if (type === "writeup") {
    return withPromptContract(
      "writeup intelligence: similar incident/CTF writeups with actionable methods",
      "Do not cover cve/docs/github librarian tracks; do not perform local code exploration.",
      [
        "[Aegis Subagent Dispatch: Librarian / Similar Writeups]",
        `Query: ${query}`,
        "Find similar CTF or real-world incident writeups with actionable exploitation notes.",
        "Prioritize high-signal methodology and reproducible steps.",
        "Return 3-5 references with URL and 1-2 line applicability summary.",
      ]
    );
  }

  if (type === "docs") {
    return withPromptContract(
      "documentation intelligence: official docs and version-specific security guidance",
      "Do not cover cve/writeup/github librarian tracks; do not perform local code exploration.",
      [
        "[Aegis Subagent Dispatch: Librarian / Official Documentation]",
        `Query: ${query}`,
        "Find official docs and security guidance for frameworks, APIs, libraries, and configurations involved.",
        "Prefer primary documentation and version-specific guidance.",
        "Return 3-5 references with URL and 1-2 line applicability summary.",
      ]
    );
  }

  return withPromptContract(
    "github intelligence: OSS examples, issues, and security discussions",
    "Do not cover cve/writeup/docs librarian tracks; do not perform local code exploration.",
    [
      "[Aegis Subagent Dispatch: Librarian / GitHub Examples]",
      `Query: ${query}`,
      "Find relevant OSS code examples and security discussions in GitHub repositories/issues.",
      "Prioritize patterns that map to likely exploitation or validation techniques.",
      "Return 3-5 references with URL and 1-2 line applicability summary.",
    ]
  );
}

function buildLibrarianTracks(searchTypes: LibrarianSearchType[], query: string): DispatchPlan["tracks"] {
  return searchTypes.map((searchType) => ({
    purpose: `aegis-librarian-${searchType}`,
    agent: "aegis-librarian",
    prompt: buildLibrarianPrompt(searchType, query),
  }));
}

export function planExploreDispatch(
  state: SessionState,
  query: string,
  options?: { maxTracks?: number; focusAreas?: string[] }
): DispatchPlan {
  const normalizedQuery = compactQuery(query, "targeted attack-surface exploration");
  const focusAreas = cleanList(options?.focusAreas);
  const maxTracks = clampMaxTracks(options?.maxTracks, DEFAULT_EXPLORE_TRACKS);
  const tracks = buildExploreTracks(state, normalizedQuery, focusAreas).slice(0, maxTracks);

  return {
    label: `aegis-explore-${safeLabel(normalizedQuery)}`,
    tracks,
  };
}

export function planLibrarianDispatch(
  state: SessionState,
  query: string,
  options?: { searchTypes?: ("cve" | "writeup" | "docs" | "github")[]; maxTracks?: number }
): DispatchPlan {
  const normalizedQuery = compactQuery(query, "security reference lookup");
  const maxTracks = clampMaxTracks(options?.maxTracks, DEFAULT_LIBRARIAN_TRACKS);
  const requestedTypes = cleanList(options?.searchTypes);
  const searchTypes =
    requestedTypes.length > 0
      ? (requestedTypes as LibrarianSearchType[])
      : detectSearchTypes(`${state.mode} ${normalizedQuery}`);

  const tracks = buildLibrarianTracks(searchTypes, normalizedQuery).slice(0, maxTracks);

  return {
    label: `aegis-librarian-${safeLabel(normalizedQuery)}`,
    tracks,
  };
}

export function detectSubagentType(query: string): "explore" | "librarian" {
  const normalized = query.toLowerCase();

  if (normalized.includes("cve") || normalized.includes("docs") || normalized.includes("api")) {
    return "librarian";
  }
  if (normalized.includes("file") || normalized.includes("code") || normalized.includes("binary")) {
    return "explore";
  }

  const librarianScore = countHints(normalized, LIBRARIAN_HINTS);
  const exploreScore = countHints(normalized, EXPLORE_HINTS);

  if (librarianScore > exploreScore) {
    return "librarian";
  }
  return "explore";
}

export function planMultiSubagentDispatch(
  state: SessionState,
  requests: SubagentRequest[]
): DispatchPlan {
  if (requests.length === 0) {
    return {
      label: "aegis-subagent-empty",
      tracks: [],
    };
  }

  const combinedTracks: DispatchPlan["tracks"] = [];

  for (const [requestIndex, request] of requests.entries()) {
    const basePlan =
      request.type === "explore"
        ? planExploreDispatch(state, request.query)
        : planLibrarianDispatch(state, request.query);

    const suffix = request.background ? "background" : "foreground";

    for (const [trackIndex, track] of basePlan.tracks.entries()) {
      combinedTracks.push({
        purpose: `req-${requestIndex + 1}-${trackIndex + 1}-${suffix}-${track.purpose}`,
        agent: track.agent,
        prompt: withOptionalContext(track.prompt, request.context),
      });
    }
  }

  return {
    label: `aegis-subagent-multi-${requests.length}`,
    tracks: combinedTracks,
  };
}
