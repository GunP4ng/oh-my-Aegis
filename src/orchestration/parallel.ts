/**
 * Parallel CTF orchestration module.
 *
 * Uses OpenCode SDK session primitives (session.create, session.promptAsync,
 * session.messages, session.abort) to dispatch multiple child sessions in
 * parallel and merge results.
 */

import type { OrchestratorConfig } from "../config/schema";
import type { SessionState, TargetType } from "../state/types";
import { hasErrorResponse } from "../utils/sdk-response";
import { agentModel } from "./model-health";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { debugLog } from "../utils/debug-log";

// ── Types ──

export interface ParallelTrack {
  sessionID: string;
  purpose: string;
  agent: string;
  provider: string;
  prompt: string;
  status: "pending" | "running" | "completed" | "aborted" | "failed";
  createdAt: number;
  completedAt: number;
  result: string;
  isWinner: boolean;
}

export interface ParallelGroup {
  parentSessionID: string;
  label: string;
  tracks: ParallelTrack[];
  queue: DispatchPlan["tracks"];
  parallel: {
    capDefault: number;
    providerCaps: Record<string, number>;
    queueEnabled: boolean;
  };
  createdAt: number;
  completedAt: number;
  winnerSessionID: string;
  maxTracks: number;
}

export interface DispatchPlan {
  tracks: Array<{
    purpose: string;
    agent: string;
    prompt: string;
  }>;
  label: string;
}

// ── In-memory state ──

const groupsByParent = new Map<string, ParallelGroup[]>();
let parallelStateFilePath: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 40;

type PersistedTrack = {
  sessionID: string;
  purpose: string;
  agent: string;
  provider: string;
  status: ParallelTrack["status"];
  createdAt: number;
  completedAt: number;
  result: string;
  isWinner: boolean;
};

type PersistedGroup = {
  parentSessionID: string;
  label: string;
  tracks: PersistedTrack[];
  createdAt: number;
  completedAt: number;
  winnerSessionID: string;
  maxTracks: number;
};

type PersistedParallelState = {
  updatedAt: string;
  groups: PersistedGroup[];
};

function toPersistedTrack(track: ParallelTrack): PersistedTrack {
  return {
    sessionID: track.sessionID,
    purpose: track.purpose,
    agent: track.agent,
    provider: track.provider,
    status: track.status,
    createdAt: track.createdAt,
    completedAt: track.completedAt,
    result: track.result,
    isWinner: track.isWinner,
  };
}

function fromPersistedTrack(track: PersistedTrack): ParallelTrack {
  return {
    ...track,
    prompt: "",
  };
}

function serializeGroups(): PersistedParallelState {
  const groups: PersistedGroup[] = [];
  for (const [, parentGroups] of groupsByParent.entries()) {
    for (const group of parentGroups) {
      groups.push({
        parentSessionID: group.parentSessionID,
        label: group.label,
        tracks: group.tracks.map(toPersistedTrack),
        createdAt: group.createdAt,
        completedAt: group.completedAt,
        winnerSessionID: group.winnerSessionID,
        maxTracks: group.maxTracks,
      });
    }
  }
  return {
    updatedAt: new Date().toISOString(),
    groups,
  };
}

function loadPersistedGroups(): void {
  if (!parallelStateFilePath || !existsSync(parallelStateFilePath)) {
    return;
  }
  try {
    const raw = readFileSync(parallelStateFilePath, "utf-8");
    const parsed = JSON.parse(raw) as PersistedParallelState;
    const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
    groupsByParent.clear();
    for (const group of groups) {
      if (!group || typeof group !== "object") continue;
      const parentSessionID = typeof group.parentSessionID === "string" ? group.parentSessionID : "";
      if (!parentSessionID) continue;
      const tracksRaw = Array.isArray(group.tracks) ? group.tracks : [];
      const tracks: ParallelTrack[] = tracksRaw
        .filter((item): item is PersistedTrack => Boolean(item) && typeof item === "object")
        .map(fromPersistedTrack);
      const hydrated: ParallelGroup = {
        parentSessionID,
        label: typeof group.label === "string" ? group.label : "parallel",
        tracks,
        queue: [],
        parallel: {
          capDefault: 2,
          providerCaps: {},
          queueEnabled: true,
        },
        createdAt: typeof group.createdAt === "number" ? group.createdAt : Date.now(),
        completedAt: typeof group.completedAt === "number" ? group.completedAt : 0,
        winnerSessionID: typeof group.winnerSessionID === "string" ? group.winnerSessionID : "",
        maxTracks: typeof group.maxTracks === "number" ? group.maxTracks : tracks.length,
      };
      const existing = groupsByParent.get(parentSessionID) ?? [];
      existing.push(hydrated);
      groupsByParent.set(parentSessionID, existing);
    }
  } catch (error) {
    debugLog("parallel", "loadPersistedGroups failed", error);
    return;
  }
}

export function configureParallelPersistence(projectDir: string, rootDirName = ".Aegis"): void {
  parallelStateFilePath = join(projectDir, rootDirName, "parallel_state.json");
  loadPersistedGroups();
}

export function persistParallelGroups(): void {
  if (!parallelStateFilePath) {
    return;
  }
  try {
    mkdirSync(dirname(parallelStateFilePath), { recursive: true });
    const tmp = `${parallelStateFilePath}.tmp`;
    const payload = `${JSON.stringify(serializeGroups())}\n`;
    writeFileSync(tmp, payload, "utf-8");
    renameSync(tmp, parallelStateFilePath);
  } catch (error) {
    debugLog("parallel", "persistParallelGroups failed", error);
    return;
  }
}

export function persistParallelGroupsDeferred(): void {
  if (persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistParallelGroups();
  }, PERSIST_DEBOUNCE_MS);
  if (persistTimer && typeof (persistTimer as { unref?: () => void }).unref === "function") {
    (persistTimer as { unref: () => void }).unref();
  }
}

export function getGroups(parentSessionID: string): ParallelGroup[] {
  return groupsByParent.get(parentSessionID) ?? [];
}

export function getActiveGroup(parentSessionID: string): ParallelGroup | null {
  const groups = getGroups(parentSessionID);
  if (groups.length === 0) return null;
  const last = groups[groups.length - 1];
  if (last.completedAt > 0) return null;
  return last;
}

export function getAllGroups(): Map<string, ParallelGroup[]> {
  return groupsByParent;
}

// ── Planning ──

const TARGET_SCAN_AGENTS: Record<TargetType, string> = {
  WEB_API: "ctf-web",
  WEB3: "ctf-web3",
  PWN: "ctf-pwn",
  REV: "ctf-rev",
  CRYPTO: "ctf-crypto",
  FORENSICS: "ctf-forensics",
  MISC: "ctf-explore",
  UNKNOWN: "ctf-explore",
};

function providerIdFromModel(model: string): string {
  const trimmed = model.trim();
  const idx = trimmed.indexOf("/");
  if (idx === -1) return trimmed;
  return trimmed.slice(0, idx);
}

function providerForAgent(agent: string): string {
  const model = agentModel(agent);
  if (!model) return "unknown";
  const provider = providerIdFromModel(model);
  return provider || "unknown";
}

export function planScanDispatch(
  state: SessionState,
  config: OrchestratorConfig,
  challengeDescription: string,
): DispatchPlan {
  const target = state.targetType;

  if (state.mode === "BOUNTY") {
    const bountyBasePrompt = challengeDescription.trim()
      ? `[Parallel SCAN track]\n\nTarget:\n${challengeDescription.slice(0, 2000)}\n\n`
      : "[Parallel SCAN track]\n\n";

    if (!state.scopeConfirmed) {
      return {
        tracks: [
          {
            purpose: "scope-first",
            agent: "bounty-scope",
            prompt:
              `${bountyBasePrompt}` +
              "Scope is not confirmed. Perform scope confirmation and safe target framing only. " +
              "Do not run active validation.",
          },
        ],
        label: "scan-bounty-scope",
      };
    }

    const bountyScanAgent = config.routing.bounty.scan[target] ?? "bounty-triage";
    const bountyScan = config.parallel.bounty_scan;
    const maxTracks = bountyScan.max_tracks;
    const triageTracks = bountyScan.triage_tracks;
    const researchTracks = bountyScan.research_tracks;
    const scopeRecheckTracks = bountyScan.scope_recheck_tracks;
    const requestedTracks = triageTracks + researchTracks + scopeRecheckTracks;
    const tracks: DispatchPlan["tracks"] = [];

    const addTrack = (
      purposePrefix: string,
      agent: string,
      count: number,
      promptText: string,
    ) => {
      for (let i = 0; i < count; i += 1) {
        const index = count > 1 ? `-${i + 1}` : "";
        tracks.push({
          purpose: `${purposePrefix}${index}`,
          agent,
          prompt: `${bountyBasePrompt}${promptText}`,
        });
      }
    };

    if (requestedTracks <= 0) {
      addTrack(
        "surface-triage",
        bountyScanAgent,
        1,
        "Run scope-safe surface triage in parallel. Prioritize read-only reconnaissance and minimal-impact evidence collection. Output top 5 observations and one safest next action.",
      );
      addTrack(
        "bounty-research",
        "bounty-research",
        1,
        "Research target-relevant vulnerability classes and known patterns. Return top 3 hypotheses with cheapest low-impact validation for each.",
      );
      addTrack(
        "scope-recheck",
        "bounty-scope",
        1,
        "Re-validate in-scope boundaries, assets, and safe testing constraints. List explicit must-not-do actions before execution phase.",
      );
    } else {
      addTrack(
        "surface-triage",
        bountyScanAgent,
        triageTracks,
        "Run scope-safe surface triage in parallel. Prioritize read-only reconnaissance and minimal-impact evidence collection. Output top 5 observations and one safest next action.",
      );
      addTrack(
        "bounty-research",
        "bounty-research",
        researchTracks,
        "Research target-relevant vulnerability classes and known patterns. Return top 3 hypotheses with cheapest low-impact validation for each.",
      );
      addTrack(
        "scope-recheck",
        "bounty-scope",
        scopeRecheckTracks,
        "Re-validate in-scope boundaries, assets, and safe testing constraints. List explicit must-not-do actions before execution phase.",
      );
    }

    return { tracks: tracks.slice(0, maxTracks), label: `scan-bounty-${target.toLowerCase()}` };
  }

  const domainAgent = TARGET_SCAN_AGENTS[target] ?? "ctf-explore";

  const basePrompt = challengeDescription.trim()
    ? `[Parallel SCAN track]\n\nChallenge:\n${challengeDescription.slice(0, 2000)}\n\n`
    : "[Parallel SCAN track]\n\n";

  const tracks: DispatchPlan["tracks"] = [
    {
      purpose: "fast-recon",
      agent: "ctf-explore",
      prompt: `${basePrompt}Perform fast initial reconnaissance. Identify file types, protections, strings, basic structure. Output SCAN.md-style summary with top 5 observations. Do NOT attempt to solve yet.`,
    },
    {
      purpose: `domain-scan-${target.toLowerCase()}`,
      agent: domainAgent,
      prompt: `${basePrompt}Perform domain-specific deep scan for ${target} target. Focus on attack surface, vulnerability patterns, and tool-specific analysis (e.g., checksec for PWN, endpoint enumeration for WEB_API). Output structured observations.`,
    },
    {
      purpose: "research-cve",
      agent: "ctf-research",
      prompt: `${basePrompt}Research known CVEs, CTF writeups, and exploitation techniques relevant to this challenge. Search for similar challenges, framework/library versions, and known vulnerability patterns. Return top 3 hypotheses with cheapest disconfirm test for each.`,
    },
  ];

  // Deduplicate if domain agent == ctf-explore
  if (domainAgent === "ctf-explore") {
    tracks.splice(1, 1);
  }

  return { tracks, label: `scan-${target.toLowerCase()}` };
}

export function planHypothesisDispatch(
  state: SessionState,
  config: OrchestratorConfig,
  hypotheses: Array<{ hypothesis: string; disconfirmTest: string }>,
): DispatchPlan {
  const agent =
    state.mode === "CTF"
      ? config.routing.ctf.execute[state.targetType] ?? "aegis-exec"
      : !state.scopeConfirmed
        ? "bounty-scope"
        : config.routing.bounty.execute[state.targetType] ?? "aegis-exec";

  const tracks: DispatchPlan["tracks"] = hypotheses.slice(0, 3).map((h, i) => ({
    purpose: `hypothesis-${i + 1}`,
    agent,
    prompt: [
      `[Parallel HYPOTHESIS track ${i + 1}]`,
      ``,
      `Hypothesis: ${h.hypothesis}`,
      ``,
      `Execute the cheapest disconfirm test:`,
      h.disconfirmTest,
      ``,
      `Rules:`,
      `- Do exactly 1 test.`,
      `- Record observation.`,
      `- State whether hypothesis is SUPPORTED, REFUTED, or INCONCLUSIVE.`,
      `- Do NOT proceed beyond this single test.`,
    ].join("\n"),
  }));

  return { tracks, label: "hypothesis-test" };
}

export function planDeepWorkerDispatch(
  state: SessionState,
  config: OrchestratorConfig,
  goal: string,
): DispatchPlan {
  const target = state.targetType;
  const trimmedGoal = goal.trim();
  const basePrompt = trimmedGoal
    ? `[Parallel DEEP-WORK track]\n\nGoal:\n${trimmedGoal.slice(0, 2000)}\n\n`
    : "[Parallel DEEP-WORK track]\n\n";

  if (state.mode === "BOUNTY" && !state.scopeConfirmed) {
    return {
      label: "deep-scope",
      tracks: [
        {
          purpose: "scope-first",
          agent: "bounty-scope",
          prompt: `${basePrompt}Scope is not confirmed. Do scope-first triage only and stop.`,
        },
      ],
    };
  }

  if (state.mode === "BOUNTY") {
    return {
      label: `deep-bounty-${target.toLowerCase()}`,
      tracks: [
        {
          purpose: "bounty-triage",
          agent: "bounty-triage",
          prompt: `${basePrompt}Do scope-safe triage. Prefer read-only evidence and minimal-impact validation steps. Return 2-3 concrete hypotheses and ONE next TODO.`,
        },
        {
          purpose: "bounty-research",
          agent: "bounty-research",
          prompt: `${basePrompt}Do scope-safe vulnerability research (CVE/config/misuse patterns). Return 2-3 hypotheses + cheapest minimal-impact validations.`,
        },
        {
          purpose: "budget-compact",
          agent: "md-scribe",
          prompt: `${basePrompt}If notes are noisy/long, compact durable notes and return a concise CONTEXT_PACK style summary for safe continuation.`,
        },
      ],
    };
  }

  if (target !== "PWN" && target !== "REV") {
    const plan = planScanDispatch(state, config, trimmedGoal);
    return { ...plan, label: `deep-${target.toLowerCase()}` };
  }

  const tracks: DispatchPlan["tracks"] =
    target === "PWN"
      ? [
          {
            purpose: "pwn-primitive",
            agent: "ctf-pwn",
            prompt: `${basePrompt}Find the vulnerability class + exploitation primitive. Provide deterministic repro steps and the cheapest next test.`,
          },
          {
            purpose: "exploit-skeleton",
            agent: "ctf-solve",
            prompt: `${basePrompt}Draft an exploit skeleton and a minimal validation loop (local first). Focus on reliability and evidence.`,
          },
          {
            purpose: "env-parity",
            agent: "ctf-explore",
            prompt: `${basePrompt}Check environment parity assumptions (arch, protections, libc/loader, remote constraints). List cheapest confirmations.`,
          },
          {
            purpose: "research-technique",
            agent: "ctf-research",
            prompt: `${basePrompt}Search for similar PWN patterns and likely exploitation techniques. Return top 3 hypotheses + cheapest disconfirm tests.`,
          },
        ]
      : [
          {
            purpose: "rev-static",
            agent: "ctf-rev",
            prompt: `${basePrompt}Do static analysis: locate key logic, inputs, checks, and candidate constraints. Return top observations and likely pivot points.`,
          },
          {
            purpose: "rev-dynamic",
            agent: "ctf-explore",
            prompt: `${basePrompt}Do dynamic/runtime-grounded probing (run traces, observe behavior, inputs/outputs). Return concrete evidence artifacts to collect.`,
          },
          {
            purpose: "rev-instrument",
            agent: "ctf-rev",
            prompt: `${basePrompt}Propose the cheapest instrumentation/patch to dump runtime-expected values (avoid full solve). Provide exact next TODO.`,
          },
          {
            purpose: "research-obfuscation",
            agent: "ctf-research",
            prompt: `${basePrompt}Research similar REV patterns (VM/packer/anti-debug) and list 2-3 likely techniques + cheapest validations.`,
          },
        ];

  return { tracks, label: `deep-${target.toLowerCase()}` };
}

// ── Dispatch ──

export interface SessionClient {
  // NOTE: OpenCode SDK v1 and v2 accept different argument shapes.
  // We treat these as untyped call sites and attempt both shapes.
  create: (options: unknown) => Promise<any>;
  promptAsync: (options: unknown) => Promise<any>;
  messages: (options: unknown) => Promise<any>;
  fork?: (options: unknown) => Promise<any>;
  abort: (options: unknown) => Promise<any>;
  status: (options?: unknown) => Promise<any>;
  children: (options: unknown) => Promise<any>;
}

const hasError = hasErrorResponse;

function extractSessionIdFromResponse(response: unknown): string | null {
  if (typeof response === "string" && response.trim().length > 0) {
    return response.trim();
  }

  if (!response || typeof response !== "object") {
    return null;
  }

  const root = response as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : null;
  const info = data?.info && typeof data.info === "object" ? (data.info as Record<string, unknown>) : null;
  const rootInfo = root.info && typeof root.info === "object" ? (root.info as Record<string, unknown>) : null;
  const dataSession = data?.session && typeof data.session === "object" ? (data.session as Record<string, unknown>) : null;
  const rootSession = root.session && typeof root.session === "object" ? (root.session as Record<string, unknown>) : null;
  const properties =
    root.properties && typeof root.properties === "object"
      ? (root.properties as Record<string, unknown>)
      : null;
  const propertiesInfo =
    properties?.info && typeof properties.info === "object"
      ? (properties.info as Record<string, unknown>)
      : null;

  const candidates = [
    data?.id,
    data?.sessionID,
    data?.sessionId,
    data?.session_id,
    info?.id,
    info?.sessionID,
    info?.sessionId,
    info?.session_id,
    rootInfo?.id,
    rootInfo?.sessionID,
    rootInfo?.sessionId,
    rootInfo?.session_id,
    dataSession?.id,
    dataSession?.sessionID,
    dataSession?.sessionId,
    rootSession?.id,
    rootSession?.sessionID,
    rootSession?.sessionId,
    propertiesInfo?.id,
    propertiesInfo?.sessionID,
    propertiesInfo?.sessionId,
    root.id,
    root.sessionID,
    root.sessionId,
    root.session_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function summarizeCreateAttemptResult(result: unknown): string {
  if (result === null) return "result=null";
  if (result === undefined) return "result=undefined";
  if (typeof result === "string") return `result=string(len=${result.length})`;
  if (typeof result !== "object") return `result=${typeof result}`;

  const root = result as Record<string, unknown>;
  const rootKeys = Object.keys(root).slice(0, 6).join(",");
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : null;
  const dataKeys = data ? Object.keys(data).slice(0, 6).join(",") : "";
  const id = extractSessionIdFromResponse(result);
  if (id) return `id=${id}`;
  return `rootKeys=[${rootKeys}] dataKeys=[${dataKeys}]`;
}

interface SessionCreateCallResult {
  sessionID: string | null;
  failure?: string;
}

async function callSessionCreateId(
  sessionClient: SessionClient,
  directory: string,
  parentID: string,
  title: string,
): Promise<SessionCreateCallResult> {
  const tryExtract = (result: unknown): string | null => {
    if (hasError(result)) {
      return null;
    }
    return extractSessionIdFromResponse(result);
  };

  const failures: string[] = [];

  const attemptCreate = async (label: string, payload: unknown): Promise<string | null> => {
    try {
      const result = await sessionClient.create(payload);
      const id = tryExtract(result);
      if (id) return id;
      failures.push(`${label}: no-id (${summarizeCreateAttemptResult(result)})`);
      return null;
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const attemptFork = async (label: string, payload: unknown): Promise<string | null> => {
    if (typeof sessionClient.fork !== "function") {
      return null;
    }
    try {
      const result = await sessionClient.fork(payload);
      const id = tryExtract(result);
      if (id) return id;
      failures.push(`${label}: no-id (${summarizeCreateAttemptResult(result)})`);
      return null;
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const attempts: Array<() => Promise<string | null>> = [
    () =>
      attemptCreate("create-query-body-parentID", {
        query: { directory },
        body: { parentID, title },
      }),
    () =>
      attemptCreate("create-query-body-parentId", {
        query: { directory },
        body: { parentId: parentID, title },
      }),
    () => attemptCreate("create-flat-parentID", { directory, parentID, title }),
    () => attemptCreate("create-flat-parentId", { directory, parentId: parentID, title }),
    () =>
      attemptCreate("create-query-body-no-parent", {
        query: { directory },
        body: { title },
      }),
    () => attemptCreate("create-flat-no-parent", { directory, title }),
    () =>
      attemptFork("fork-path-id-query", {
        path: { id: parentID },
        query: { directory },
        body: {},
      }),
    () =>
      attemptFork("fork-path-sessionID-query", {
        path: { sessionID: parentID },
        query: { directory },
        body: {},
      }),
    () => attemptFork("fork-flat-sessionID", { sessionID: parentID, directory }),
    () => attemptFork("fork-flat-id", { id: parentID, directory }),
    () => attemptCreate("create-body-title", { body: { title } }),
    () => attemptCreate("create-empty", {}),
  ];

  for (const attempt of attempts) {
    const id = await attempt();
    if (id) {
      return { sessionID: id };
    }
  }

  const failure = failures.length > 0 ? failures.join(" | ").slice(0, 1200) : "unknown";
  return { sessionID: null, failure };
}

async function callSessionPromptAsync(
  sessionClient: SessionClient,
  sessionID: string,
  directory: string,
  agent: string,
  prompt: string,
  system?: string,
): Promise<boolean> {
  const body = {
    agent,
    system,
    tools: {
      task: false,
      background_task: false,
    } as Record<string, boolean>,
    parts: [{ type: "text", text: prompt }],
  };

  try {
    const primary = await sessionClient.promptAsync({
      path: { id: sessionID },
      query: { directory },
      body,
    });
    if (!hasError(primary)) return true;
  } catch (error) {
    debugLog("parallel", `promptAsync primary failed session=${sessionID}`, error);
  }

  try {
    const fallback = await sessionClient.promptAsync({
      sessionID,
      directory,
      agent,
      system,
      tools: body.tools,
      parts: body.parts,
    });
    return !hasError(fallback);
  } catch (error) {
    debugLog("parallel", `promptAsync fallback failed session=${sessionID}`, error);
    return false;
  }
}

async function callSessionMessagesData(
  sessionClient: SessionClient,
  sessionID: string,
  directory: string,
  limit: number,
): Promise<unknown[] | null> {
  try {
    const primary = await sessionClient.messages({
      path: { id: sessionID },
      query: { directory, limit },
    });
    if (Array.isArray(primary?.data) && !hasError(primary)) return primary.data;
  } catch (error) {
    debugLog("parallel", `messages primary failed session=${sessionID}`, error);
  }

  try {
    const fallback = await sessionClient.messages({ sessionID, directory, limit });
    if (Array.isArray(fallback?.data) && !hasError(fallback)) return fallback.data;
  } catch (error) {
    debugLog("parallel", `messages fallback failed session=${sessionID}`, error);
  }

  return null;
}

async function callSessionAbort(
  sessionClient: SessionClient,
  sessionID: string,
  directory: string,
): Promise<boolean> {
  try {
    const primary = await sessionClient.abort({ path: { id: sessionID }, query: { directory } });
    if (!hasError(primary)) return true;
  } catch (error) {
    debugLog("parallel", `abort primary failed session=${sessionID}`, error);
  }

  try {
    const fallback = await sessionClient.abort({ sessionID, directory });
    return !hasError(fallback);
  } catch (error) {
    debugLog("parallel", `abort fallback failed session=${sessionID}`, error);
    return false;
  }
}

export function extractSessionClient(client: unknown): SessionClient | null {
  if (!client || typeof client !== "object") return null;
  const c = client as Record<string, unknown>;
  const session = c.session;
  if (!session || typeof session !== "object") return null;
  const s = session as Record<string, unknown>;

  const hasCreate = typeof s.create === "function";
  const hasPromptAsync = typeof s.promptAsync === "function";
  const hasMessages = typeof s.messages === "function";
  const hasAbort = typeof s.abort === "function";
  const hasFork = typeof s.fork === "function";
  const hasStatus = typeof s.status === "function";
  const hasChildren = typeof s.children === "function";

  if (!hasCreate || !hasPromptAsync || !hasMessages || !hasAbort) {
    return null;
  }

  const bindSessionMethod = <T extends (...args: any[]) => any>(
    fn: unknown,
    fallback: T,
  ): T => {
    if (typeof fn !== "function") return fallback;
    return (fn as T).bind(session) as T;
  };

  const create = bindSessionMethod<SessionClient["create"]>(s.create, async () => ({ error: true }));
  const promptAsync = bindSessionMethod<SessionClient["promptAsync"]>(
    s.promptAsync,
    async () => ({ error: true }),
  );
  const messages = bindSessionMethod<SessionClient["messages"]>(s.messages, async () => ({ error: true }));
  const abort = bindSessionMethod<SessionClient["abort"]>(s.abort, async () => ({ error: true }));
  const fork = hasFork
    ? bindSessionMethod<NonNullable<SessionClient["fork"]>>(s.fork, async () => ({ error: true }))
    : undefined;
  const status = hasStatus
    ? bindSessionMethod<SessionClient["status"]>(s.status, async () => ({ data: {} }))
    : async () => ({ data: {} });
  const children = hasChildren
    ? bindSessionMethod<SessionClient["children"]>(s.children, async () => ({ data: undefined }))
    : async () => ({ data: undefined });

  return {
    create,
    promptAsync,
    messages,
    fork,
    abort,
    status,
    children,
  };
}

export async function dispatchParallel(
  sessionClient: SessionClient,
  parentSessionID: string,
  directory: string,
  plan: DispatchPlan,
  maxTracks: number,
  options?: {
    systemPrompt?: string;
    parallel?: OrchestratorConfig["parallel"];
  },
): Promise<ParallelGroup> {
  const parallelConfig = options?.parallel;
  const capDefault = parallelConfig?.max_concurrent_per_provider ?? 2;
  const providerCaps = parallelConfig?.provider_caps ?? {};
  const queueEnabled = parallelConfig?.queue_enabled ?? true;

  const group: ParallelGroup = {
    parentSessionID,
    label: plan.label,
    tracks: [],
    queue: [],
    parallel: {
      capDefault,
      providerCaps,
      queueEnabled,
    },
    createdAt: Date.now(),
    completedAt: 0,
    winnerSessionID: "",
    maxTracks,
  };

  const tracksToDispatch = plan.tracks.slice(0, maxTracks);

  const activeByProvider: Record<string, number> = {};

  for (const trackPlan of tracksToDispatch) {
    const provider = providerForAgent(trackPlan.agent);
    const cap = providerCaps[provider] ?? capDefault;
    if (queueEnabled && cap > 0 && (activeByProvider[provider] ?? 0) >= cap) {
      group.queue.push(trackPlan);
      continue;
    }

    const track: ParallelTrack = {
      sessionID: "",
      purpose: trackPlan.purpose,
      agent: trackPlan.agent,
      provider,
      prompt: trackPlan.prompt,
      status: "pending",
      createdAt: Date.now(),
      completedAt: 0,
      result: "",
      isWinner: false,
    };

    try {
      const title = `[Aegis Parallel] ${plan.label} / ${trackPlan.purpose}`;
      const createResult = await callSessionCreateId(sessionClient, directory, parentSessionID, title);
      const sessionID = createResult.sessionID;
      if (!sessionID) {
        track.status = "failed";
        track.result = createResult.failure
          ? `Failed to create child session (no ID returned): ${createResult.failure}`
          : "Failed to create child session (no ID returned)";
        group.tracks.push(track);
        continue;
      }

      track.sessionID = sessionID;
      track.status = "running";

      const prompted = await callSessionPromptAsync(
        sessionClient,
        sessionID,
        directory,
        trackPlan.agent,
        trackPlan.prompt,
        options?.systemPrompt,
      );
      if (!prompted) {
        track.status = "failed";
        track.result = "Failed to prompt child session (promptAsync error)";
      }

      group.tracks.push(track);
      activeByProvider[provider] = (activeByProvider[provider] ?? 0) + 1;
    } catch (error) {
      track.status = "failed";
      track.result = `Dispatch error: ${error instanceof Error ? error.message : String(error)}`;
      group.tracks.push(track);
    }
  }

  // Store group
  const existing = groupsByParent.get(parentSessionID) ?? [];
  existing.push(group);
  groupsByParent.set(parentSessionID, existing);
  persistParallelGroups();

  return group;
}

export async function dispatchQueuedTracks(
  sessionClient: SessionClient,
  group: ParallelGroup,
  directory: string,
  systemPrompt?: string,
): Promise<number> {
  if (!group.parallel.queueEnabled) return 0;
  if (group.queue.length === 0) return 0;

  const activeByProvider: Record<string, number> = {};
  for (const t of group.tracks) {
    if (t.status !== "running" && t.status !== "pending") continue;
    activeByProvider[t.provider] = (activeByProvider[t.provider] ?? 0) + 1;
  }

  const capDefault = group.parallel.capDefault;
  const providerCaps = group.parallel.providerCaps;
  const capFor = (provider: string): number => providerCaps[provider] ?? capDefault;

  let dispatched = 0;
  let progressed = true;
  while (progressed && group.queue.length > 0) {
    progressed = false;
    for (let i = 0; i < group.queue.length; i += 1) {
      const trackPlan = group.queue[i] as DispatchPlan["tracks"][number];
      const provider = providerForAgent(trackPlan.agent);
      const cap = capFor(provider);
      if (cap > 0 && (activeByProvider[provider] ?? 0) >= cap) {
        continue;
      }

      group.queue.splice(i, 1);

      const track: ParallelTrack = {
        sessionID: "",
        purpose: trackPlan.purpose,
        agent: trackPlan.agent,
        provider,
        prompt: trackPlan.prompt,
        status: "pending",
        createdAt: Date.now(),
        completedAt: 0,
        result: "",
        isWinner: false,
      };

      try {
        const title = `[Aegis Parallel] ${group.label} / ${trackPlan.purpose}`;
        const createResult = await callSessionCreateId(sessionClient, directory, group.parentSessionID, title);
        const sessionID = createResult.sessionID;
        if (!sessionID) {
          track.status = "failed";
          track.result = createResult.failure
            ? `Failed to create child session (no ID returned): ${createResult.failure}`
            : "Failed to create child session (no ID returned)";
          group.tracks.push(track);
          progressed = true;
          dispatched += 1;
          break;
        }

        track.sessionID = sessionID;
        track.status = "running";

        const prompted = await callSessionPromptAsync(
          sessionClient,
          sessionID,
          directory,
          trackPlan.agent,
          trackPlan.prompt,
          systemPrompt,
        );
        if (!prompted) {
          track.status = "failed";
          track.result = "Failed to prompt child session (promptAsync error)";
        }

        group.tracks.push(track);
        activeByProvider[provider] = (activeByProvider[provider] ?? 0) + 1;
        progressed = true;
        dispatched += 1;
        break;
      } catch (error) {
        track.status = "failed";
        track.result = `Dispatch error: ${error instanceof Error ? error.message : String(error)}`;
        group.tracks.push(track);
        progressed = true;
        dispatched += 1;
        break;
      }
    }
  }

  if (dispatched > 0) {
    persistParallelGroupsDeferred();
  }
  return dispatched;
}

// ── Collection ──

export interface CollectedResult {
  sessionID: string;
  purpose: string;
  agent: string;
  status: string;
  messages: string[];
  lastAssistantMessage: string;
}

export async function collectResults(
  sessionClient: SessionClient,
  group: ParallelGroup,
  directory: string,
  messageLimit = 5,
  options?: {
    idleSessionIDs?: Set<string>;
  },
): Promise<CollectedResult[]> {
  const results: CollectedResult[] = [];
  const idleSessionIDs = options?.idleSessionIDs;

  for (const track of group.tracks) {
    if (!track.sessionID || track.status === "failed" || track.status === "aborted") {
      results.push({
        sessionID: track.sessionID,
        purpose: track.purpose,
        agent: track.agent,
        status: track.status,
        messages: [],
        lastAssistantMessage: track.result || "(no result)",
      });
      continue;
    }

    try {
      const data = await callSessionMessagesData(sessionClient, track.sessionID, directory, messageLimit);
      const msgs: string[] = [];
      let lastAssistant = "";

      if (Array.isArray(data)) {
        for (const msg of data) {
          if (!msg || typeof msg !== "object") continue;
          const m = msg as Record<string, unknown>;
          const role =
            typeof m.role === "string"
              ? m.role
              : m.info && typeof m.info === "object" && typeof (m.info as Record<string, unknown>).role === "string"
                ? String((m.info as Record<string, unknown>).role)
                : "";
          const parts = Array.isArray(m.parts) ? m.parts : [];
          const text = parts
            .map((p: unknown) => {
              if (!p || typeof p !== "object") return "";
              const part = p as Record<string, unknown>;
              return typeof part.text === "string" ? part.text : "";
            })
            .filter(Boolean)
            .join("\n");
          if (text) {
            msgs.push(`[${role}] ${text.slice(0, 1000)}`);
            if (role === "assistant") {
              lastAssistant = text;
            }
          }
        }
      }

      if (lastAssistant) {
        track.result = lastAssistant.slice(0, 2000);
        track.status = "completed";
        track.completedAt = Date.now();
      } else if (idleSessionIDs && idleSessionIDs.has(track.sessionID)) {
        track.result = track.result || "(idle; no assistant text message found)";
        track.status = "completed";
        track.completedAt = Date.now();
      }

      results.push({
        sessionID: track.sessionID,
        purpose: track.purpose,
        agent: track.agent,
        status: track.status,
        messages: msgs,
        lastAssistantMessage: lastAssistant.slice(0, 2000),
      });
    } catch (error) {
      results.push({
        sessionID: track.sessionID,
        purpose: track.purpose,
        agent: track.agent,
        status: "failed",
        messages: [],
        lastAssistantMessage: `Collection error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // Check if group is fully completed
  const allTracksDone = group.tracks.every(
    (t) => t.status === "completed" || t.status === "failed" || t.status === "aborted",
  );
  const allDone = allTracksDone && group.queue.length === 0;
  if (allDone && group.completedAt === 0) {
    group.completedAt = Date.now();
  }

  persistParallelGroupsDeferred();

  return results;
}

// ── Abort ──

export async function abortTrack(
  sessionClient: SessionClient,
  group: ParallelGroup,
  sessionID: string,
  directory: string,
): Promise<boolean> {
  const track = group.tracks.find((t) => t.sessionID === sessionID);
  if (!track) return false;
  if (track.status === "aborted" || track.status === "completed" || track.status === "failed") {
    return false;
  }

  try {
    const ok = await callSessionAbort(sessionClient, sessionID, directory);
    if (!ok) {
      return false;
    }
    track.status = "aborted";
    track.completedAt = Date.now();
    persistParallelGroupsDeferred();
    return true;
  } catch (error) {
    debugLog("parallel", `abortTrack failed session=${sessionID}`, error);
    return false;
  }
}

export async function abortAllExcept(
  sessionClient: SessionClient,
  group: ParallelGroup,
  winnerSessionID: string,
  directory: string,
): Promise<number> {
  let aborted = 0;
  if (group.queue.length > 0) {
    aborted += group.queue.length;
    group.queue = [];
  }
  for (const track of group.tracks) {
    if (track.sessionID === winnerSessionID) {
      track.isWinner = true;
      continue;
    }
    if (track.status !== "running" && track.status !== "pending") continue;
    const ok = await abortTrack(sessionClient, group, track.sessionID, directory);
    if (ok) aborted += 1;
  }
  group.winnerSessionID = winnerSessionID;
  group.completedAt = Date.now();
  persistParallelGroupsDeferred();
  return aborted;
}

export async function abortAll(
  sessionClient: SessionClient,
  group: ParallelGroup,
  directory: string,
): Promise<number> {
  let aborted = 0;
  if (group.queue.length > 0) {
    aborted += group.queue.length;
    group.queue = [];
  }
  for (const track of group.tracks) {
    if (track.status !== "running" && track.status !== "pending") continue;
    const ok = await abortTrack(sessionClient, group, track.sessionID, directory);
    if (ok) aborted += 1;
  }
  group.completedAt = Date.now();
  persistParallelGroupsDeferred();
  return aborted;
}

// ── Summary ──

export function groupSummary(group: ParallelGroup): Record<string, unknown> {
  return {
    label: group.label,
    parentSessionID: group.parentSessionID,
    createdAt: new Date(group.createdAt).toISOString(),
    completedAt: group.completedAt > 0 ? new Date(group.completedAt).toISOString() : null,
    winnerSessionID: group.winnerSessionID || null,
    maxTracks: group.maxTracks,
    queued: group.queue.length,
    tracks: group.tracks.map((t) => ({
      sessionID: t.sessionID,
      purpose: t.purpose,
      agent: t.agent,
      status: t.status,
      isWinner: t.isWinner,
      resultPreview: t.result ? t.result.slice(0, 200) : null,
    })),
  };
}
