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
import {
  agentModel,
  baseAgentName,
  isKnownModelId,
  isModelHealthy,
  resolveHealthyModel,
  shouldGenerateVariants,
  variantAgentName,
} from "./model-health";
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
  /** 현재 수행 중인 작업 한줄 설명 (tool.execute.after 훅에서 갱신) */
  lastActivity: string;
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
  winnerRationale?: string;
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

export interface ParallelStructuredResult {
  findings: unknown[];
  evidence: unknown[];
  next_todo: string[];
}

export interface CollectResultsOutput {
  results: CollectedResult[];
  merged: ParallelStructuredResult;
  quarantinedSessionIDs: string[];
}

// ── In-memory state ──

const groupsByParent = new Map<string, ParallelGroup[]>();
let parallelStateFilePath: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistenceBlockedByFutureSchema = false;
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
  lastActivity: string;
};

type PersistedGroup = {
  parentSessionID: string;
  label: string;
  tracks: PersistedTrack[];
  createdAt: number;
  completedAt: number;
  winnerSessionID: string;
  winnerRationale?: string;
  maxTracks: number;
};

type PersistedParallelState = {
  schemaVersion: 2;
  updatedAt: string;
  groups: PersistedGroup[];
};

type PersistedParallelStateV1 = {
  updatedAt: string;
  groups: PersistedGroup[];
};

const PARALLEL_STATE_SCHEMA_VERSION = 2;

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
    lastActivity: track.lastActivity,
  };
}

function fromPersistedTrack(track: PersistedTrack): ParallelTrack {
  return {
    ...track,
    prompt: "",
    lastActivity: typeof track.lastActivity === "string" ? track.lastActivity : "",
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
        winnerRationale: typeof group.winnerRationale === "string" ? group.winnerRationale : "",
        maxTracks: group.maxTracks,
      });
    }
  }
  return {
    schemaVersion: PARALLEL_STATE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    groups,
  };
}

function loadPersistedGroups(): void {
  groupsByParent.clear();
  persistenceBlockedByFutureSchema = false;

  if (!parallelStateFilePath || !existsSync(parallelStateFilePath)) {
    return;
  }
  try {
    const raw = readFileSync(parallelStateFilePath, "utf-8");
    const parsed = JSON.parse(raw) as PersistedParallelState | PersistedParallelStateV1;
    if (
      parsed
      && typeof parsed === "object"
      && "schemaVersion" in parsed
      && typeof (parsed as { schemaVersion?: unknown }).schemaVersion === "number"
      && (parsed as { schemaVersion: number }).schemaVersion !== PARALLEL_STATE_SCHEMA_VERSION
    ) {
      persistenceBlockedByFutureSchema = true;
      return;
    }
    const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
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
        winnerRationale: typeof group.winnerRationale === "string" ? group.winnerRationale : "",
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
  if (!parallelStateFilePath || persistenceBlockedByFutureSchema) {
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
  if (persistenceBlockedByFutureSchema || persistTimer) {
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

const BOUNTY_TRIAGE_EVIDENCE_CLASSES = [
  "HTTP headers and security header posture",
  "TLS certificates and endpoint identity metadata",
  "public content surfaces and response body clues",
  "client-side JavaScript behavior and exposed routes",
  "API surface shape and parameter behavior",
];

function withPromptContract(uniqueFocus: string, doNotCover: string[], body: string): string {
  return [
    `UniqueFocus: ${uniqueFocus}`,
    `DoNotCover: ${doNotCover.join("; ")}`,
    "OutputContract: Return ONLY valid JSON. No markdown, code fences, or prose.",
    'OutputSchema: {"findings":[...],"evidence":[...],"next_todo":[...]}',
    "OutputRules: findings/evidence/next_todo must be arrays. Use [] when unknown.",
    "",
    body,
  ].join("\n");
}

const REASK_JSON_ONLY_PROMPT = [
  "Your previous response was invalid for the required contract.",
  "Return ONLY valid JSON. No markdown, no code fences, no prose.",
  'Schema: {"findings":[...],"evidence":[...],"next_todo":[...]}',
  "Rules:",
  "- findings: array",
  "- evidence: array",
  "- next_todo: array of short strings",
  "- use [] when unknown",
].join("\n");

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((key) => `${key}:${stableStringify(obj[key])}`);
    return `{${parts.join(",")}}`;
  }
  return String(value);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/["'`]/g, "")
    .trim();
}

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function toTokenSet(text: string): Set<string> {
  const cleaned = normalizeText(text).replace(/[^a-z0-9 ]/g, " ");
  const tokens = cleaned
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  return new Set(tokens);
}

function jaccardSimilarity(a: string, b: string): number {
  const aSet = toTokenSet(a);
  const bSet = toTokenSet(b);
  if (aSet.size === 0 && bSet.size === 0) return 1;
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  const union = aSet.size + bSet.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

function ensureStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const output: string[] = [];
  for (const item of input) {
    const value = typeof item === "string" ? item.trim() : stableStringify(item).trim();
    if (value) output.push(value);
  }
  return output;
}

function parseStructuredResult(text: string): ParallelStructuredResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const findingsRaw = record.findings;
  const evidenceRaw = record.evidence;
  const nextTodoRaw = record.next_todo;
  if (findingsRaw !== undefined && !Array.isArray(findingsRaw)) return null;
  if (evidenceRaw !== undefined && !Array.isArray(evidenceRaw)) return null;
  if (nextTodoRaw !== undefined && !Array.isArray(nextTodoRaw)) return null;
  return {
    findings: Array.isArray(findingsRaw) ? findingsRaw : [],
    evidence: Array.isArray(evidenceRaw) ? evidenceRaw : [],
    next_todo: ensureStringArray(nextTodoRaw),
  };
}

function findingCanonicalText(finding: unknown): string {
  if (typeof finding === "string") return normalizeText(finding);
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return normalizeText(stableStringify(finding));
  }
  const rec = finding as Record<string, unknown>;
  const preferred = ["title", "summary", "finding", "text", "description"];
  const values = preferred
    .map((key) => rec[key])
    .filter((value) => value !== undefined)
    .map((value) => stableStringify(value));
  if (values.length > 0) {
    return normalizeText(values.join(" | "));
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rec)) {
    if (key === "id" || key === "finding_id" || key === "findingId" || key.toLowerCase().endsWith("_id")) {
      continue;
    }
    sanitized[key] = value;
  }
  return normalizeText(stableStringify(sanitized));
}

function evidenceTuple(evidence: unknown): { findingID: string; source: string; quote: string } {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return {
      findingID: "",
      source: "",
      quote: normalizeText(stableStringify(evidence)),
    };
  }
  const rec = evidence as Record<string, unknown>;
  const findingID = normalizeText(
    stableStringify(rec.finding_id ?? rec.findingId ?? rec.id ?? ""),
  );
  const source = normalizeText(stableStringify(rec.source ?? rec.path ?? rec.file ?? rec.url ?? ""));
  const quote = normalizeText(
    stableStringify(rec.quote ?? rec.excerpt ?? rec.text ?? rec.content ?? ""),
  );
  return { findingID, source, quote };
}

function mergeStructuredResults(items: ParallelStructuredResult[]): ParallelStructuredResult {
  const findings: unknown[] = [];
  const findingsSeen = new Set<string>();
  const findingTexts: string[] = [];
  const evidence: unknown[] = [];
  const evidenceSeen = new Set<string>();
  const nextTodo: string[] = [];
  const nextTodoSeen = new Set<string>();

  for (const item of items) {
    for (const finding of item.findings) {
      const canonical = findingCanonicalText(finding);
      const exactKey = fnv1aHash(canonical);
      if (findingsSeen.has(exactKey)) continue;
      let nearDuplicate = false;
      for (const existing of findingTexts) {
        if (jaccardSimilarity(existing, canonical) >= 0.92) {
          nearDuplicate = true;
          break;
        }
      }
      if (nearDuplicate) continue;
      findingsSeen.add(exactKey);
      findingTexts.push(canonical);
      findings.push(finding);
    }

    for (const evidenceItem of item.evidence) {
      const tuple = evidenceTuple(evidenceItem);
      const evidenceKey = fnv1aHash(`${tuple.findingID}|${tuple.source}|${tuple.quote}`);
      if (evidenceSeen.has(evidenceKey)) continue;
      evidenceSeen.add(evidenceKey);
      evidence.push(evidenceItem);
    }

    for (const todo of item.next_todo) {
      const normalized = normalizeText(todo);
      if (!normalized || nextTodoSeen.has(normalized)) continue;
      nextTodoSeen.add(normalized);
      nextTodo.push(todo);
    }
  }

  return {
    findings,
    evidence,
    next_todo: nextTodo,
  };
}

function extractMessagesAndLastAssistant(data: unknown[] | null): { messages: string[]; lastAssistant: string } {
  const messages: string[] = [];
  let lastAssistant = "";
  if (!Array.isArray(data)) {
    return { messages, lastAssistant };
  }

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
    if (!text) continue;
    messages.push(`[${role}] ${text.slice(0, 1000)}`);
    if (role === "assistant") {
      lastAssistant = text;
    }
  }

  return { messages, lastAssistant };
}

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

type TrackPlanWithIndex = DispatchPlan["tracks"][number] & { _index: number };

function trackPlanSortKey(trackPlan: TrackPlanWithIndex): string {
  return `${providerForAgent(trackPlan.agent)}|${trackPlan._index.toString().padStart(6, "0")}|${trackPlan.agent}|${trackPlan.purpose}`;
}

function cloneModelHealth(state?: SessionState): SessionState["modelHealthByModel"] {
  if (!state) return {};
  return { ...state.modelHealthByModel };
}

function cloneDispatchHealth(state?: SessionState): SessionState["dispatchHealthBySubagent"] {
  if (!state) return {};
  return { ...state.dispatchHealthBySubagent };
}

function isSubagentUnhealthy(state: SessionState | undefined, agent: string): boolean {
  if (!state) return false;
  const baseAgent = baseAgentName(agent);
  const health = state.dispatchHealthBySubagent[baseAgent];
  if (!health) return false;
  return (
    health.consecutiveFailureCount >= 2
    || health.hardFailureCount > health.successCount
  );
}

function unresolvedModelIsUnhealthy(state: SessionState | undefined, model: string | undefined, cooldownMs: number): boolean {
  if (!state || !model) return false;
  return !isModelHealthy(state, model, cooldownMs);
}

function resolveHealthyAgentForTrack(
  trackPlan: DispatchPlan["tracks"][number],
  state: SessionState | undefined,
  cooldownMs: number,
): { trackPlan: DispatchPlan["tracks"][number]; provider: string; canDispatch: boolean } {
  if (!state) {
    const provider = providerForAgent(trackPlan.agent);
    return { trackPlan, provider, canDispatch: true };
  }

  const currentProvider = providerForAgent(trackPlan.agent);
  const currentModel = agentModel(trackPlan.agent);
  const desiredModel = resolveHealthyModel(trackPlan.agent, state, cooldownMs);
  const desiredHealthy = desiredModel ? isModelHealthy(state, desiredModel, cooldownMs) : true;

  if (!desiredModel || !desiredHealthy) {
    return { trackPlan, provider: currentProvider, canDispatch: false };
  }

  if (desiredModel === currentModel) {
    return { trackPlan, provider: currentProvider, canDispatch: true };
  }

  const baseAgent = baseAgentName(trackPlan.agent);
  if (!shouldGenerateVariants(baseAgent)) {
    return {
      trackPlan: { ...trackPlan, agent: baseAgent },
      provider: providerIdFromModel(desiredModel),
      canDispatch: true,
    };
  }

  if (!isKnownModelId(desiredModel)) {
    return {
      trackPlan: { ...trackPlan, agent: baseAgent },
      provider: providerIdFromModel(desiredModel),
      canDispatch: true,
    };
  }

  const fallbackAgent = variantAgentName(baseAgent, desiredModel);
  return {
    trackPlan: { ...trackPlan, agent: fallbackAgent },
    provider: providerIdFromModel(desiredModel),
    canDispatch: true,
  };
}

function effectiveProviderCap(
  provider: string,
  capDefault: number,
  providerCaps: Record<string, number>,
  modelHealthByModel: SessionState["modelHealthByModel"],
  dispatchHealthBySubagent: SessionState["dispatchHealthBySubagent"],
): number {
  const baseCap = providerCaps[provider] ?? capDefault;
  if (baseCap <= 0) return baseCap;

  let penalty = 0;
  const hasUnhealthyModelForProvider = Object.keys(modelHealthByModel)
    .some((model) => providerIdFromModel(model) === provider);
  if (hasUnhealthyModelForProvider) penalty += 1;

  const hasUnhealthySubagent = Object.entries(dispatchHealthBySubagent)
    .some(([subagent, health]) => {
      const model = agentModel(subagent);
      if (!model || providerIdFromModel(model) !== provider) return false;
      return health.consecutiveFailureCount >= 2 || health.hardFailureCount > health.successCount;
    });
  if (hasUnhealthySubagent) penalty += 1;

  if (penalty <= 0) return baseCap;
  return Math.max(1, baseCap - penalty);
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
            prompt: withPromptContract(
              "scope-first focused on scope confirmation",
              ["Active validation", "Exploit attempts"],
              `${bountyBasePrompt}Scope is not confirmed. Perform scope confirmation and safe target framing only. Do not run active validation.`,
            ),
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
      buildPromptText: (index: number, count: number) => string,
    ) => {
      for (let i = 0; i < count; i += 1) {
        const index = count > 1 ? `-${i + 1}` : "";
        tracks.push({
          purpose: `${purposePrefix}${index}`,
          agent,
          prompt: buildPromptText(i, count),
        });
      }
    };

    if (requestedTracks <= 0) {
      addTrack(
        "surface-triage",
        bountyScanAgent,
        1,
        (index, count) => {
          const evidenceClass = BOUNTY_TRIAGE_EVIDENCE_CLASSES[index % BOUNTY_TRIAGE_EVIDENCE_CLASSES.length];
          return withPromptContract(
            `surface-triage TrackIndex=${index + 1}/${count} focused on ${evidenceClass}`,
            [
              "Bounty research hypothesis generation",
              "Scope recheck and policy revalidation",
            ],
            `${bountyBasePrompt}Run scope-safe surface triage in parallel. Prioritize read-only reconnaissance and minimal-impact evidence collection. Output top 5 observations and one safest next action.`,
          );
        },
      );
      addTrack(
        "bounty-research",
        "bounty-research",
        1,
        () =>
          withPromptContract(
            "bounty-research focused on external vuln pattern and prior-art mapping",
            [
              "Surface triage evidence collection",
              "Scope boundary re-validation",
            ],
            `${bountyBasePrompt}Research target-relevant vulnerability classes and known patterns. Return top 3 hypotheses with cheapest low-impact validation for each.`,
          ),
      );
      addTrack(
        "scope-recheck",
        "bounty-scope",
        1,
        () =>
          withPromptContract(
            "scope-recheck focused on in-scope boundaries and safety constraints",
            [
              "Surface triage evidence collection",
              "External vulnerability research",
            ],
            `${bountyBasePrompt}Re-validate in-scope boundaries, assets, and safe testing constraints. List explicit must-not-do actions before execution phase.`,
          ),
      );
    } else {
      addTrack(
        "surface-triage",
        bountyScanAgent,
        triageTracks,
        (index, count) => {
          const evidenceClass = BOUNTY_TRIAGE_EVIDENCE_CLASSES[index % BOUNTY_TRIAGE_EVIDENCE_CLASSES.length];
          const allClasses = BOUNTY_TRIAGE_EVIDENCE_CLASSES.slice(0, Math.max(count, 2));
          const forbiddenClasses = allClasses
            .filter((item) => item !== evidenceClass)
            .slice(0, 2)
            .map((item) => `surface-triage evidence class: ${item}`);
          return withPromptContract(
            `surface-triage TrackIndex=${index + 1}/${count} focused on ${evidenceClass}`,
            [...forbiddenClasses, "Bounty research hypothesis generation", "Scope recheck and policy revalidation"],
            `${bountyBasePrompt}Run scope-safe surface triage in parallel. Prioritize read-only reconnaissance and minimal-impact evidence collection. Output top 5 observations and one safest next action.`,
          );
        },
      );
      addTrack(
        "bounty-research",
        "bounty-research",
        researchTracks,
        (index, count) =>
          withPromptContract(
            `bounty-research TrackIndex=${index + 1}/${count} focused on external vuln pattern and prior-art mapping`,
            [
              "Surface triage evidence collection",
              "Scope boundary re-validation",
            ],
            `${bountyBasePrompt}Research target-relevant vulnerability classes and known patterns. Return top 3 hypotheses with cheapest low-impact validation for each.`,
          ),
      );
      addTrack(
        "scope-recheck",
        "bounty-scope",
        scopeRecheckTracks,
        (index, count) =>
          withPromptContract(
            `scope-recheck TrackIndex=${index + 1}/${count} focused on in-scope boundaries and safety constraints`,
            [
              "Surface triage evidence collection",
              "External vulnerability research",
            ],
            `${bountyBasePrompt}Re-validate in-scope boundaries, assets, and safe testing constraints. List explicit must-not-do actions before execution phase.`,
          ),
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
      prompt: `${withPromptContract(
        "fast-recon focused on file types, protections, strings, directory layout, and top observations",
        [
          `domain-scan-${target.toLowerCase()} deep domain tool analysis`,
          "research-cve external CVE and writeup research",
        ],
        `${basePrompt}Perform fast initial reconnaissance. Identify file types, protections, strings, basic structure. Output SCAN.md-style summary with top 5 observations. Do NOT attempt to solve yet.`,
      )}`,
    },
    {
      purpose: `domain-scan-${target.toLowerCase()}`,
      agent: domainAgent,
      prompt: `${withPromptContract(
        `domain-scan-${target.toLowerCase()} focused on domain-specific deep scan and tool-driven analysis`,
        [
          "fast-recon generic file inventory and broad triage",
          "research-cve external CVE and writeup research",
        ],
        `${basePrompt}Perform domain-specific deep scan for ${target} target. Focus on attack surface, vulnerability patterns, and tool-specific analysis (e.g., checksec for PWN, endpoint enumeration for WEB_API). Output structured observations.`,
      )}`,
    },
    {
      purpose: "research-cve",
      agent: "ctf-research",
      prompt: `${withPromptContract(
        "research-cve focused on external CVEs, writeups, and prior exploitation patterns",
        [
          "fast-recon local file and binary inventory",
          `domain-scan-${target.toLowerCase()} local domain tool execution`,
        ],
        `${basePrompt}Research known CVEs, CTF writeups, and exploitation techniques relevant to this challenge. Search for similar challenges, framework/library versions, and known vulnerability patterns. Return top 3 hypotheses with cheapest disconfirm test for each.`,
      )}`,
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
      `UniqueFocus: hypothesis-${i + 1} single cheapest disconfirm test execution`,
      `DoNotCover: ${hypotheses
        .slice(0, 3)
        .map((_other, index) => index + 1)
        .filter((index) => index !== i + 1)
        .map((index) => `tests assigned to hypothesis-${index}`)
        .slice(0, 4)
        .join("; ")}`,
      "",
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
      `- Do NOT run tests assigned to other hypothesis tracks in this dispatch.`,
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
          prompt: withPromptContract(
            "scope-first deep worker path for unconfirmed bounty scope",
            [
              "Bounty triage hypothesis expansion",
              "Bounty research external vulnerability mapping",
            ],
            `${basePrompt}Scope is not confirmed. Do scope-first triage only and stop.`,
          ),
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
          prompt: withPromptContract(
            "bounty-triage deep worker focused on scope-safe evidence triage",
            [
              "Bounty research external pattern mining",
              "Budget-compact note compaction",
            ],
            `${basePrompt}Do scope-safe triage. Prefer read-only evidence and minimal-impact validation steps. Return 2-3 concrete hypotheses and ONE next TODO.`,
          ),
        },
        {
          purpose: "bounty-research",
          agent: "bounty-research",
          prompt: withPromptContract(
            "bounty-research deep worker focused on external CVE/config/misuse patterns",
            [
              "Bounty triage local evidence collection",
              "Budget-compact note compaction",
            ],
            `${basePrompt}Do scope-safe vulnerability research (CVE/config/misuse patterns). Return 2-3 hypotheses + cheapest minimal-impact validations.`,
          ),
        },
        {
          purpose: "budget-compact",
          agent: "md-scribe",
          prompt: withPromptContract(
            "budget-compact focused on compressing durable notes and context transfer",
            [
              "Bounty triage evidence gathering",
              "Bounty research vulnerability hypothesis generation",
            ],
            `${basePrompt}If notes are noisy/long, compact durable notes and return a concise CONTEXT_PACK style summary for safe continuation.`,
          ),
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
          prompt: withPromptContract(
            "pwn-primitive focused on vulnerability class and exploitation primitive identification",
            [
              "exploit-skeleton drafting and validation loop design",
              "env-parity confirmation and environment assumptions",
              "research-technique external pattern lookup",
            ],
            `${basePrompt}Find the vulnerability class + exploitation primitive. Provide deterministic repro steps and the cheapest next test.`,
          ),
        },
        {
          purpose: "exploit-skeleton",
          agent: "ctf-solve",
          prompt: withPromptContract(
            "exploit-skeleton focused on minimal reliable exploit scaffold and validation loop",
            [
              "pwn-primitive vulnerability classification",
              "env-parity environment parity confirmations",
              "research-technique external writeup and CVE mining",
            ],
            `${basePrompt}Draft an exploit skeleton and a minimal validation loop (local first). Focus on reliability and evidence.`,
          ),
        },
        {
          purpose: "env-parity",
          agent: "ctf-explore",
          prompt: withPromptContract(
            "env-parity focused on arch/protection/libc-loader/remote constraint parity",
            [
              "pwn-primitive vulnerability classification",
              "exploit-skeleton exploit draft authoring",
              "research-technique external pattern research",
            ],
            `${basePrompt}Check environment parity assumptions (arch, protections, libc/loader, remote constraints). List cheapest confirmations.`,
          ),
        },
        {
          purpose: "research-technique",
          agent: "ctf-research",
          prompt: withPromptContract(
            "research-technique focused on external PWN pattern and exploitation prior-art research",
            [
              "pwn-primitive local vulnerability classification",
              "exploit-skeleton local exploit drafting",
              "env-parity local environment verification",
            ],
            `${basePrompt}Search for similar PWN patterns and likely exploitation techniques. Return top 3 hypotheses + cheapest disconfirm tests.`,
          ),
        },
      ]
      : [
        {
          purpose: "rev-static",
          agent: "ctf-rev",
          prompt: withPromptContract(
            "rev-static focused on static structure, key logic map, checks, and constraints",
            [
              "rev-dynamic runtime observation and trace collection",
              "rev-instrument instrumentation or patch proposal",
              "research-obfuscation external VM/packer prior-art research",
            ],
            `${basePrompt}Do static analysis: locate key logic, inputs, checks, and candidate constraints. Return top observations and likely pivot points.`,
          ),
        },
        {
          purpose: "rev-dynamic",
          agent: "ctf-explore",
          prompt: withPromptContract(
            "rev-dynamic focused on runtime-grounded probing and concrete artifact capture",
            [
              "rev-static deep static decompilation and logic reconstruction",
              "rev-instrument proposing or applying instrumentation patches",
              "research-obfuscation external obfuscation technique research",
            ],
            `${basePrompt}Do dynamic/runtime-grounded probing (run traces, observe behavior, inputs/outputs). Return concrete evidence artifacts to collect.`,
          ),
        },
        {
          purpose: "rev-instrument",
          agent: "ctf-rev",
          prompt: withPromptContract(
            "rev-instrument focused on cheapest instrumentation or patch to dump runtime values",
            [
              "rev-static full static solve attempts",
              "rev-dynamic broad runtime recon without instrumentation design",
              "research-obfuscation external writeup synthesis",
            ],
            `${basePrompt}Propose the cheapest instrumentation/patch to dump runtime-expected values (avoid full solve). Provide exact next TODO.`,
          ),
        },
        {
          purpose: "research-obfuscation",
          agent: "ctf-research",
          prompt: withPromptContract(
            "research-obfuscation focused on external VM/packer/anti-debug technique research",
            [
              "rev-static local binary static analysis",
              "rev-dynamic local runtime probing",
              "rev-instrument local instrumentation and patch planning",
            ],
            `${basePrompt}Research similar REV patterns (VM/packer/anti-debug) and list 2-3 likely techniques + cheapest validations.`,
          ),
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
    state?: SessionState;
  },
): Promise<ParallelGroup> {
  const parallelConfig = options?.parallel;
  const capDefault = parallelConfig?.max_concurrent_per_provider ?? 2;
  const providerCaps = parallelConfig?.provider_caps ?? {};
  const queueEnabled = parallelConfig?.queue_enabled ?? true;
  const state = options?.state;
  const modelCooldownMs = 300_000;
  const modelHealthByModel = cloneModelHealth(state);
  const dispatchHealthBySubagent = cloneDispatchHealth(state);

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
    winnerRationale: "",
    maxTracks,
  };

  const tracksToDispatch = plan.tracks
    .slice(0, maxTracks)
    .map((trackPlan, index) => ({ ...trackPlan, _index: index }))
    .sort((a, b) => {
      const aKey = trackPlanSortKey(a);
      const bKey = trackPlanSortKey(b);
      return aKey.localeCompare(bKey);
    });

  const activeByProvider: Record<string, number> = {};

  for (const indexedPlan of tracksToDispatch) {
    const rawPlan: DispatchPlan["tracks"][number] = {
      purpose: indexedPlan.purpose,
      agent: indexedPlan.agent,
      prompt: indexedPlan.prompt,
    };
    const resolved = resolveHealthyAgentForTrack(rawPlan, state, modelCooldownMs);
    const trackPlan = resolved.trackPlan;
    const provider = resolved.provider;
    const cap = effectiveProviderCap(
      provider,
      capDefault,
      providerCaps,
      modelHealthByModel,
      dispatchHealthBySubagent,
    );
    if (state) {
      const candidateModel = agentModel(trackPlan.agent);
      const unhealthyModel = unresolvedModelIsUnhealthy(state, candidateModel, modelCooldownMs);
      const unhealthySubagent = isSubagentUnhealthy(state, trackPlan.agent);
      if (!resolved.canDispatch || unhealthyModel || unhealthySubagent) {
        group.queue.push(rawPlan);
        continue;
      }
    }
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
      lastActivity: "",
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
        lastActivity: "",
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
): Promise<CollectResultsOutput> {
  const results: CollectedResult[] = [];
  const parsedByTrack: ParallelStructuredResult[] = [];
  const quarantinedSessionIDs: string[] = [];
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
      const initial = extractMessagesAndLastAssistant(data);
      const msgs = initial.messages;
      let lastAssistant = initial.lastAssistant;
      let structured = lastAssistant ? parseStructuredResult(lastAssistant) : null;

      if (!structured && lastAssistant) {
        const reaskPrompted = await callSessionPromptAsync(
          sessionClient,
          track.sessionID,
          directory,
          track.agent,
          REASK_JSON_ONLY_PROMPT,
        );
        if (reaskPrompted) {
          const retryData = await callSessionMessagesData(sessionClient, track.sessionID, directory, messageLimit);
          const retried = extractMessagesAndLastAssistant(retryData);
          if (retried.messages.length > 0) {
            msgs.push(...retried.messages);
          }
          if (retried.lastAssistant) {
            lastAssistant = retried.lastAssistant;
            structured = parseStructuredResult(lastAssistant);
          }
        }
      }

      if (!structured && lastAssistant) {
        quarantinedSessionIDs.push(track.sessionID);
      } else if (structured) {
        parsedByTrack.push(structured);
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

  return {
    results,
    merged: mergeStructuredResults(parsedByTrack),
    quarantinedSessionIDs,
  };
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
  winnerRationale?: string,
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
  group.winnerRationale = typeof winnerRationale === "string" ? winnerRationale.trim().slice(0, 240) : "";
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
    winnerRationale: group.winnerRationale && group.winnerRationale.trim().length > 0
      ? group.winnerRationale
      : null,
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

// ── Flow Renderer Exports ──

export interface FlowTrackSnapshot {
  sessionID: string;
  agent: string;
  purpose: string;
  lastActivity: string;
  status: ParallelTrack["status"];
  isWinner: boolean;
  durationMs: number;
}

export interface FlowGroupSnapshot {
  label: string;
  completedCount: number;
  totalCount: number;
  winnerSessionID: string;
  tracks: FlowTrackSnapshot[];
}

/** tmux 렌더러에서 읽는 현재 병렬 그룹 스냅샷 */
export function getParallelGroupSnapshots(parentSessionID: string): FlowGroupSnapshot[] {
  return (groupsByParent.get(parentSessionID) ?? []).map((g) => ({
    label: g.label,
    completedCount: g.tracks.filter(
      (t) => t.status !== "pending" && t.status !== "running"
    ).length,
    totalCount: g.tracks.length,
    winnerSessionID: g.winnerSessionID,
    tracks: g.tracks.map((t) => ({
      sessionID: t.sessionID,
      agent: t.agent,
      purpose: t.purpose,
      lastActivity: t.lastActivity,
      status: t.status,
      isWinner: t.isWinner,
      durationMs:
        t.completedAt > 0 ? t.completedAt - t.createdAt : Date.now() - t.createdAt,
    })),
  }));
}

/** tool.execute.after 훅에서 특정 트랙의 현재 작업 설명을 갱신 */
export function updateTrackActivity(childSessionID: string, activity: string): void {
  for (const groups of groupsByParent.values()) {
    for (const group of groups) {
      const track = group.tracks.find((t) => t.sessionID === childSessionID);
      if (track && track.status === "running") {
        track.lastActivity = activity;
        return;
      }
    }
  }
}
