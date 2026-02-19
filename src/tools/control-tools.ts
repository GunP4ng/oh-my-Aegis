import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
import { buildReadinessReport } from "../config/readiness";
import { resolveFailoverAgent, route } from "../orchestration/router";
import { createAstGrepTools } from "./ast-tools";
import { createLspTools } from "./lsp-tools";
import {
  abortAll,
  abortAllExcept,
  collectResults,
  dispatchParallel,
  extractSessionClient,
  getActiveGroup,
  getGroups,
  groupSummary,
  planDeepWorkerDispatch,
  planHypothesisDispatch,
  planScanDispatch,
  type DispatchPlan,
} from "../orchestration/parallel";
import type { ParallelBackgroundManager } from "../orchestration/parallel-background";
import { getExploitTemplate, listExploitTemplates } from "../orchestration/exploit-templates";
import { triageFile, buildTriageSummary } from "../orchestration/auto-triage";
import { scanForFlags, getCandidates, clearCandidates, buildFlagAlert, setCustomFlagPattern } from "../orchestration/flag-detector";
import { matchPatterns, listPatterns, buildPatternSummary } from "../orchestration/pattern-matcher";
import { recommendedTools, checksecCommand, parseChecksecOutput } from "../orchestration/tool-integration";
import { planReconPipeline } from "../orchestration/recon-pipeline";
import { saveScanSnapshot, buildDeltaSummary, shouldRescan, getLatestSnapshot, computeDelta, type ScanSnapshot } from "../orchestration/delta-scan";
import { localLookup, buildLibcSummary, computeLibcBase, buildLibcRipUrl, type LibcLookupRequest } from "../orchestration/libc-database";
import { buildParityReport, buildParitySummary, parseDockerfile, parseLddOutput, localEnvCommands, type EnvInfo } from "../orchestration/env-parity";
import { generateReport, formatReportMarkdown } from "../orchestration/report-generator";
import { planExploreDispatch, planLibrarianDispatch, detectSubagentType } from "../orchestration/subagent-dispatch";
import type { NotesStore } from "../state/notes-store";
import { type SessionStore } from "../state/session-store";
import { normalizeSessionID } from "../state/session-id";
import { type FailureReason, type SessionEvent, type TargetType } from "../state/types";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const schema = tool.schema;
const FAILURE_REASON_VALUES: FailureReason[] = [
  "verification_mismatch",
  "tooling_timeout",
  "context_overflow",
  "hypothesis_stall",
  "exploit_chain",
  "environment",
];

export function createControlTools(
  store: SessionStore,
  notesStore: NotesStore,
  config: OrchestratorConfig,
  projectDir: string,
  client: unknown,
  parallelBackgroundManager: ParallelBackgroundManager
): Record<string, ToolDefinition> {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const hasError = (result: unknown): boolean => {
    if (!isRecord(result)) return false;
    return Boolean(result.error);
  };

  const safeJsonParse = (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const extractAgentModels = (opencodePath: string | null): string[] => {
    if (!opencodePath) return [];
    let parsed: unknown;
    try {
      parsed = safeJsonParse(readFileSync(opencodePath, "utf-8"));
    } catch {
      return [];
    }
    if (!isRecord(parsed)) return [];
    const agentCandidate = isRecord(parsed.agent) ? parsed.agent : isRecord(parsed.agents) ? parsed.agents : null;
    if (!agentCandidate) return [];
    const models: string[] = [];
    for (const value of Object.values(agentCandidate)) {
      if (!isRecord(value)) continue;
      const m = value.model;
      if (typeof m === "string" && m.trim().length > 0) {
        models.push(m.trim());
      }
    }
    return [...new Set(models)];
  };

  const getClaudeCompatibilityReport = (): {
    settings: { files: string[] };
    rules: { dir: string; mdFiles: number };
    mcp_json: { path: string; found: boolean; servers: Array<{ name: string; type?: string }> };
  } => {
    const settingsDir = join(projectDir, ".claude");
    const settingsFiles = [
      join(settingsDir, "settings.json"),
      join(settingsDir, "settings.local.json"),
    ].filter((p) => existsSync(p));

    const rulesDir = join(settingsDir, "rules");
    let ruleMdFiles = 0;
    try {
      if (existsSync(rulesDir)) {
        const stack: string[] = [rulesDir];
        while (stack.length > 0 && ruleMdFiles < 200) {
          const dir = stack.pop() as string;
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const p = join(dir, e.name);
            if (e.isDirectory()) {
              stack.push(p);
              continue;
            }
            if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
              ruleMdFiles += 1;
            }
          }
        }
      }
    } catch {
      ruleMdFiles = 0;
    }

    const mcpPath = join(projectDir, ".mcp.json");
    const servers: Array<{ name: string; type?: string }> = [];
    if (existsSync(mcpPath)) {
      try {
        const raw = readFileSync(mcpPath, "utf-8");
        const parsed = safeJsonParse(raw);
        const candidate =
          isRecord(parsed) && isRecord((parsed as Record<string, unknown>).mcpServers)
            ? ((parsed as Record<string, unknown>).mcpServers as Record<string, unknown>)
            : isRecord(parsed)
              ? (parsed as Record<string, unknown>)
              : null;
        if (candidate) {
          for (const [name, value] of Object.entries(candidate)) {
            if (!isRecord(value)) {
              continue;
            }
            const type = typeof value.type === "string" ? value.type : undefined;
            servers.push({ name, type });
          }
        }
      } catch {
        servers.length = 0;
      }
    }

    return {
      settings: { files: settingsFiles.map((p) => p) },
      rules: { dir: rulesDir, mdFiles: ruleMdFiles },
      mcp_json: { path: mcpPath, found: existsSync(mcpPath), servers },
    };
  };

  const providerIdFromModel = (model: string): string => {
    const trimmed = model.trim();
    const idx = trimmed.indexOf("/");
    if (idx === -1) return trimmed;
    return trimmed.slice(0, idx);
  };
  const modelIdFromModel = (model: string): string => {
    const trimmed = model.trim();
    const idx = trimmed.indexOf("/");
    if (idx === -1) return "";
    return trimmed.slice(idx + 1);
  };

  const isInteractiveEnabledForSession = (sessionID: string): boolean => {
    if (config.interactive.enabled) return true;
    const state = store.get(sessionID);
    if (state.mode !== "CTF") return false;
    return config.interactive.enabled_in_ctf !== false;
  };

  const extractSessionApi = (): Record<string, unknown> | null => {
    const session = (client as { session?: unknown } | null)?.session as unknown;
    if (!session || typeof session !== "object") return null;
    return session as Record<string, unknown>;
  };

  const callPrimaryThenFallback = async <T>(params: {
    fn: (args: unknown) => Promise<unknown>;
    primaryArgs: unknown;
    fallbackArgs: unknown;
    extractData: (result: unknown) => T | null;
    unexpectedReason: string;
  }): Promise<{ ok: true; data: T } | { ok: false; reason: string }> => {
    try {
      const primary = await params.fn(params.primaryArgs);
      const data = params.extractData(primary);
      if (data !== null) {
        return { ok: true as const, data };
      }
    } catch (error) {
      void error;
    }

    try {
      const fallback = await params.fn(params.fallbackArgs);
      const data = params.extractData(fallback);
      if (data !== null) {
        return { ok: true as const, data };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
    return { ok: false as const, reason: params.unexpectedReason };
  };

  const callSessionList = async (directory: string, limit: number | undefined) => {
    const sessionApi = extractSessionApi();
    const listFn = (sessionApi as { list?: unknown } | null)?.list;
    if (typeof listFn === "function") {
      const listed = await callPrimaryThenFallback<unknown[]>({
        fn: listFn as (args: unknown) => Promise<unknown>,
        primaryArgs: { query: { directory, limit } },
        fallbackArgs: { directory, limit },
        extractData: (result) => {
          const candidate = isRecord(result) ? (result as Record<string, unknown>).data : null;
          return Array.isArray(candidate) ? (candidate as unknown[]) : null;
        },
        unexpectedReason: "unexpected session.list response",
      });
      if (listed.ok) {
        return { ok: true as const, data: listed.data };
      }
    }

    const sessionClient = extractSessionClient(client);
    if (!sessionClient) {
      return { ok: false as const, reason: "SDK session client not available" };
    }
    try {
      const statusMap = await sessionClient.status({ query: { directory } });
      const map = isRecord(statusMap?.data) ? (statusMap.data as Record<string, unknown>) : isRecord(statusMap) ? statusMap : {};
      const ids = Object.keys(map);
      const sliced = typeof limit === "number" && limit > 0 ? ids.slice(0, limit) : ids;
      const synthesized = sliced.map((id) => {
        const item = map[id];
        const status = isRecord(item) && typeof item.type === "string" ? item.type : undefined;
        return { id, status };
      });
      return { ok: true as const, data: synthesized };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const callSessionMessages = async (directory: string, sessionID: string, limit: number) => {
    const sessionClient = extractSessionClient(client);
    if (!sessionClient) {
      return { ok: false as const, reason: "SDK session client not available" };
    }
    const res = await callPrimaryThenFallback<unknown[]>({
      fn: sessionClient.messages as unknown as (args: unknown) => Promise<unknown>,
      primaryArgs: { path: { id: sessionID }, query: { directory, limit } },
      fallbackArgs: { sessionID, directory, limit },
      extractData: (result) => {
        if (hasError(result) || !isRecord(result)) return null;
        const data = (result as Record<string, unknown>).data;
        return Array.isArray(data) ? (data as unknown[]) : null;
      },
      unexpectedReason: "unexpected session.messages response",
    });
    return res.ok ? { ok: true as const, data: res.data } : { ok: false as const, reason: res.reason };
  };

  const ensureInsideProject = (candidatePath: string): { ok: true; abs: string } | { ok: false; reason: string } => {
    const abs = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(projectDir, candidatePath);
    const rel = relative(projectDir, abs);
    if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) {
      return { ok: true as const, abs };
    }
    return { ok: false as const, reason: "path escapes project directory" };
  };

  type MemoryObservation = {
    id: string;
    content: string;
    createdAt: string;
    deletedAt: string | null;
  };
  type MemoryEntity = {
    id: string;
    name: string;
    entityType: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    observations: MemoryObservation[];
  };
  type MemoryRelation = {
    id: string;
    from: string;
    to: string;
    relationType: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  };
  type MemoryGraph = {
    format: "aegis-knowledge-graph";
    version: 1;
    revision: number;
    createdAt: string;
    updatedAt: string;
    entities: MemoryEntity[];
    relations: MemoryRelation[];
  };

  const buildEmptyGraph = (): MemoryGraph => {
    const now = new Date().toISOString();
    return {
      format: "aegis-knowledge-graph",
      version: 1,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      entities: [],
      relations: [],
    };
  };

  const graphPaths = (): { ok: true; dir: string; file: string } | { ok: false; reason: string } => {
    const resolved = ensureInsideProject(config.memory.storage_dir);
    if (!resolved.ok) {
      return { ok: false as const, reason: `memory.storage_dir ${resolved.reason}` };
    }
    return { ok: true as const, dir: resolved.abs, file: join(resolved.abs, "knowledge-graph.json") };
  };

  const readGraph = (): { ok: true; graph: MemoryGraph } | { ok: false; reason: string } => {
    const paths = graphPaths();
    if (!paths.ok) return paths;
    try {
      if (!existsSync(paths.file)) {
        return { ok: true as const, graph: buildEmptyGraph() };
      }
      const raw = readFileSync(paths.file, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || parsed.format !== "aegis-knowledge-graph") {
        return { ok: false as const, reason: "invalid knowledge-graph format" };
      }
      const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
      const relations = Array.isArray(parsed.relations) ? parsed.relations : [];
      const graph: MemoryGraph = {
        format: "aegis-knowledge-graph",
        version: 1,
        revision: typeof parsed.revision === "number" ? parsed.revision : 0,
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
        entities: entities as MemoryEntity[],
        relations: relations as MemoryRelation[],
      };
      return { ok: true as const, graph };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const writeGraph = (graph: MemoryGraph): { ok: true } | { ok: false; reason: string } => {
    const paths = graphPaths();
    if (!paths.ok) return paths;
    try {
      mkdirSync(paths.dir, { recursive: true });
      const now = new Date().toISOString();
      graph.updatedAt = now;
      graph.revision = (graph.revision ?? 0) + 1;
      const tmp = `${paths.file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(graph, null, 2)}\n`, "utf-8");
      renameSync(tmp, paths.file);
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  type ThinkState = {
    thoughtHistoryLength: number;
    branches: Set<string>;
    totalThoughts: number;
  };
  const thinkStateBySession = new Map<string, ThinkState>();
  const ensureThinkState = (sessionID: string): ThinkState => {
    const existing = thinkStateBySession.get(sessionID);
    if (existing) return existing;
    const created: ThinkState = { thoughtHistoryLength: 0, branches: new Set<string>(), totalThoughts: 1 };
    thinkStateBySession.set(sessionID, created);
    return created;
  };

  const appendThinkRecord = (sessionID: string, payload: Record<string, unknown>): { ok: true } | { ok: false; reason: string } => {
    try {
      const root = notesStore.getRootDirectory();
      const dir = join(root, "thinking");
      const safeSessionID = normalizeSessionID(sessionID);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${safeSessionID}.jsonl`);
      const line = `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`;
      appendFileSync(file, line, "utf-8");
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const metricsPath = (): string => join(notesStore.getRootDirectory(), "metrics.json");

  const appendMetric = (entry: Record<string, unknown>): { ok: true } | { ok: false; reason: string } => {
    try {
      const path = metricsPath();
      let list: unknown = [];
      if (existsSync(path)) {
        try {
          list = JSON.parse(readFileSync(path, "utf-8"));
        } catch {
          list = [];
        }
      }
      const arr = Array.isArray(list) ? list : [];
      arr.push(entry);
      writeFileSync(path, `${JSON.stringify(arr, null, 2)}\n`, "utf-8");
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const callConfigProviders = async (directory: string) => {
    const configApi = (client as { config?: unknown } | null)?.config as unknown;
    const providersFn = (configApi as { providers?: unknown } | null)?.providers;
    if (typeof providersFn !== "function") {
      return { ok: false as const, reason: "client.config.providers unavailable" };
    }
    try {
      const result = await (providersFn as (args: unknown) => Promise<any>)({ query: { directory } });
      const data = result?.data;
      if (!data || !Array.isArray(data.providers)) {
        return { ok: false as const, reason: "unexpected /config/providers response" };
      }
      return { ok: true as const, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const callPromptAsync = async (sessionID: string, text: string, metadata: Record<string, unknown>) => {
    const sessionApi = (client as { session?: unknown } | null)?.session as unknown;
    const promptAsync = (sessionApi as { promptAsync?: unknown } | null)?.promptAsync;
    if (typeof promptAsync !== "function") {
      return { ok: false as const, reason: "client.session.promptAsync unavailable" };
    }
    try {
      await (promptAsync as (args: unknown) => Promise<unknown>)({
        path: { id: sessionID },
        body: {
          parts: [
            {
              type: "text",
              text,
              synthetic: true,
              metadata,
            },
          ],
        },
      });
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const listClaudeSkillsAndCommands = (): { skills: string[]; commands: string[] } => {
    const base = join(projectDir, ".claude");
    const skillsDir = join(base, "skills");
    const commandsDir = join(base, "commands");

    const skills: string[] = [];
    const commands: string[] = [];

    try {
      if (existsSync(skillsDir)) {
        const entries = readdirSync(skillsDir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const name = e.name;
          if (!name || name.startsWith(".")) continue;
          const skillPath = join(skillsDir, name, "SKILL.md");
          if (existsSync(skillPath)) {
            skills.push(name);
          }
        }
      }
    } catch {
      skills.length = 0;
    }

    try {
      if (existsSync(commandsDir)) {
        const entries = readdirSync(commandsDir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isFile()) continue;
          const name = e.name;
          if (!name.toLowerCase().endsWith(".md")) continue;
          const baseName = name.slice(0, -3);
          if (!baseName || baseName.startsWith(".")) continue;
          commands.push(baseName);
        }
      }
    } catch {
      commands.length = 0;
    }

    skills.sort();
    commands.sort();
    return { skills, commands };
  };

  const renderSkillTemplate = (template: string, args: string[]): string => {
    let out = template;
    out = out.replace(/\$ARGUMENTS\[(\d+)\]/g, (_m, nRaw) => {
      const n = Number(nRaw);
      if (!Number.isFinite(n) || n < 0) return "";
      return args[n] ?? "";
    });
    out = out.replace(/\$ARGUMENTS\b/g, args.join(" "));
    return out;
  };

  const loadClaudeSkillOrCommand = (name: string): { ok: true; kind: "skill" | "command"; path: string; text: string } | { ok: false; reason: string } => {
    const trimmed = name.trim();
    if (!trimmed) {
      return { ok: false, reason: "name is required" };
    }
    const base = join(projectDir, ".claude");
    const skillPath = join(base, "skills", trimmed, "SKILL.md");
    const commandPath = join(base, "commands", `${trimmed}.md`);

    const candidates: Array<{ kind: "skill" | "command"; path: string }> = [];
    if (existsSync(skillPath)) candidates.push({ kind: "skill", path: skillPath });
    if (existsSync(commandPath)) candidates.push({ kind: "command", path: commandPath });
    if (candidates.length === 0) {
      return { ok: false, reason: "not found" };
    }

    const chosen = candidates[0] as { kind: "skill" | "command"; path: string };
    try {
      const st = statSync(chosen.path);
      if (!st.isFile()) {
        return { ok: false, reason: "not a file" };
      }
      if (st.size > 128 * 1024) {
        return { ok: false, reason: "file too large" };
      }
      const text = readFileSync(chosen.path, "utf-8");
      return { ok: true, kind: chosen.kind, path: chosen.path, text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: message };
    }
  };

  const callPtyCreate = async (directory: string, body: Record<string, unknown>) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const createFn = (ptyApi as { create?: unknown } | null)?.create;
    if (typeof createFn !== "function") {
      return { ok: false as const, reason: "client.pty.create unavailable" };
    }
    try {
      const primary = await (createFn as (args: unknown) => Promise<any>)({ query: { directory }, body });
      const data = primary?.data;
      if (data) {
        return { ok: true as const, data };
      }
      const fallback = await (createFn as (args: unknown) => Promise<any>)({ directory, ...body });
      const fallbackData = fallback?.data;
      if (!fallbackData) {
        return { ok: false as const, reason: "pty.create returned no data" };
      }
      return { ok: true as const, data: fallbackData };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const callPtyList = async (directory: string) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const listFn = (ptyApi as { list?: unknown } | null)?.list;
    if (typeof listFn !== "function") {
      return { ok: false as const, reason: "client.pty.list unavailable" };
    }
    try {
      const primary = await (listFn as (args: unknown) => Promise<any>)({ query: { directory } });
      const data = primary?.data;
      if (Array.isArray(data)) {
        return { ok: true as const, data };
      }
      const fallback = await (listFn as (args: unknown) => Promise<any>)({ directory });
      const fallbackData = fallback?.data;
      if (!Array.isArray(fallbackData)) {
        return { ok: false as const, reason: "pty.list returned unexpected data" };
      }
      return { ok: true as const, data: fallbackData };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const callPtyRemove = async (directory: string, ptyID: string) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const removeFn = (ptyApi as { remove?: unknown } | null)?.remove;
    if (typeof removeFn !== "function") {
      return { ok: false as const, reason: "client.pty.remove unavailable" };
    }
    try {
      const primary = await (removeFn as (args: unknown) => Promise<any>)({ query: { directory, ptyID } });
      if (primary?.data !== undefined) {
        return { ok: true as const, data: primary.data };
      }
      const fallback = await (removeFn as (args: unknown) => Promise<any>)({ ptyID, directory });
      return { ok: true as const, data: fallback?.data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const callPtyGet = async (directory: string, ptyID: string) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const getFn = (ptyApi as { get?: unknown } | null)?.get;
    if (typeof getFn !== "function") {
      return { ok: false as const, reason: "client.pty.get unavailable" };
    }
    try {
      const primary = await (getFn as (args: unknown) => Promise<any>)({ query: { directory, ptyID } });
      const data = primary?.data;
      if (data) {
        return { ok: true as const, data };
      }
      const fallback = await (getFn as (args: unknown) => Promise<any>)({ ptyID, directory });
      const fallbackData = fallback?.data;
      if (!fallbackData) {
        return { ok: false as const, reason: "pty.get returned no data" };
      }
      return { ok: true as const, data: fallbackData };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const callPtyUpdate = async (directory: string, ptyID: string, body: Record<string, unknown>) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const updateFn = (ptyApi as { update?: unknown } | null)?.update;
    if (typeof updateFn !== "function") {
      return { ok: false as const, reason: "client.pty.update unavailable" };
    }
    try {
      const primary = await (updateFn as (args: unknown) => Promise<any>)({ query: { directory, ptyID }, body });
      if (primary?.data !== undefined) {
        return { ok: true as const, data: primary.data };
      }
    const fallback = await (updateFn as (args: unknown) => Promise<any>)({ ptyID, directory, ...body });
      return { ok: true as const, data: fallback?.data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const callPtyConnect = async (directory: string, ptyID: string) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const connectFn = (ptyApi as { connect?: unknown } | null)?.connect;
    if (typeof connectFn !== "function") {
      return { ok: false as const, reason: "client.pty.connect unavailable" };
    }
    try {
      const primary = await (connectFn as (args: unknown) => Promise<any>)({ query: { directory, ptyID } });
      const data = primary?.data;
      if (data) {
        return { ok: true as const, data };
      }
      const fallback = await (connectFn as (args: unknown) => Promise<any>)({ ptyID, directory });
      const fallbackData = fallback?.data;
      if (!fallbackData) {
        return { ok: false as const, reason: "pty.connect returned no data" };
      }
      return { ok: true as const, data: fallbackData };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const astTools = createAstGrepTools({
    projectDir,
    getMode: (sessionID) => store.get(sessionID).mode,
  });

  const lspTools = createLspTools({ client, projectDir });

  return {
    ...astTools,
    ...lspTools,
    ctf_orch_status: tool({
      description: "Get current CTF/BOUNTY orchestration state and route decision",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        const decision = route(state, config);
        return JSON.stringify({ sessionID, state, mode_explicit: state.modeExplicit, decision }, null, 2);
      },
    }),

    ctf_orch_set_mode: tool({
      description: "Set orchestrator mode (CTF or BOUNTY) for this session",
      args: {
        mode: schema.enum(["CTF", "BOUNTY"]),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.setMode(sessionID, args.mode);
        return JSON.stringify({ sessionID, mode: state.mode, mode_explicit: state.modeExplicit }, null, 2);
      },
    }),

    ctf_orch_set_ultrawork: tool({
      description: "Enable or disable ultrawork mode (continuous execution posture) for this session",
      args: {
        enabled: schema.boolean(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        store.setUltraworkEnabled(sessionID, args.enabled);
        const state = store.setAutoLoopEnabled(sessionID, args.enabled);
        return JSON.stringify(
          {
            sessionID,
            ultraworkEnabled: state.ultraworkEnabled,
            autoLoopEnabled: state.autoLoopEnabled,
          },
          null,
          2
        );
      },
    }),

    ctf_orch_set_autoloop: tool({
      description: "Enable or disable automatic loop continuation for this session",
      args: {
        enabled: schema.boolean(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.setAutoLoopEnabled(sessionID, args.enabled);
        return JSON.stringify(
          {
            sessionID,
            autoLoopEnabled: state.autoLoopEnabled,
            autoLoopIterations: state.autoLoopIterations,
          },
          null,
          2
        );
      },
    }),

    ctf_orch_event: tool({
      description: "Apply an orchestration state event (scan/plan/verify/stuck tracking)",
      args: {
        event: schema.enum([
          "scan_completed",
          "plan_completed",
          "candidate_found",
          "verify_success",
          "verify_fail",
          "no_new_evidence",
          "same_payload_repeat",
          "new_evidence",
          "readonly_inconclusive",
          "scope_confirmed",
          "context_length_exceeded",
          "timeout",
          "reset_loop",
        ]),
        session_id: schema.string().optional(),
        candidate: schema.string().optional(),
        verified: schema.string().optional(),
        hypothesis: schema.string().optional(),
        alternatives: schema.array(schema.string()).optional(),
        failure_reason: schema
          .enum([
            "verification_mismatch",
            "tooling_timeout",
            "context_overflow",
            "hypothesis_stall",
            "exploit_chain",
            "environment",
          ])
          .optional(),
        failed_route: schema.string().optional(),
        failure_summary: schema.string().optional(),
        target_type: schema
          .enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"])
          .optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (args.hypothesis) {
          store.setHypothesis(sessionID, args.hypothesis);
        }
        if (args.alternatives) {
          store.setAlternatives(sessionID, args.alternatives);
        }
        if (args.target_type) {
          store.setTargetType(sessionID, args.target_type as TargetType);
        }
        if (args.event === "candidate_found" && args.candidate) {
          store.setCandidate(sessionID, args.candidate);
        }
        if (args.event === "verify_success" && args.verified) {
          store.setVerified(sessionID, args.verified);
        }
        if (args.failure_reason) {
          store.recordFailure(sessionID, args.failure_reason as FailureReason, args.failed_route ?? "", args.failure_summary ?? "");
        }
        const state = store.applyEvent(sessionID, args.event as SessionEvent);
        if (args.event === "verify_success") {
          void appendMetric({
            at: new Date().toISOString(),
            sessionID,
            mode: state.mode,
            phase: state.phase,
            targetType: state.targetType,
            verified: state.latestVerified,
            candidate: state.latestCandidate,
            verifyFailCount: state.verifyFailCount,
            noNewEvidenceLoops: state.noNewEvidenceLoops,
            samePayloadLoops: state.samePayloadLoops,
            taskFailoverCount: state.taskFailoverCount,
          });
        }
        return JSON.stringify({ sessionID, state, decision: route(state, config) }, null, 2);
      },
    }),

    ctf_orch_metrics: tool({
      description: "Read recorded CTF/BOUNTY metrics entries",
      args: {
        limit: schema.number().int().positive().max(500).default(100),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        const path = metricsPath();
        if (!existsSync(path)) {
          return JSON.stringify({ ok: true, sessionID, entries: [] }, null, 2);
        }
        try {
          const parsed = JSON.parse(readFileSync(path, "utf-8"));
          const arr = Array.isArray(parsed) ? parsed : [];
          const entries = arr.slice(-args.limit);
          return JSON.stringify({ ok: true, sessionID, entries }, null, 2);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ ok: false, reason: message, sessionID }, null, 2);
        }
      },
    }),

    ctf_orch_next: tool({
      description: "Return the current recommended next category/agent route",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        return JSON.stringify({ sessionID, decision: route(state, config) }, null, 2);
      },
    }),

    ctf_orch_session_list: tool({
      description: "List OpenCode sessions (best-effort; falls back to status map if list API unavailable)",
      args: {
        limit: schema.number().int().positive().max(200).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const result = await callSessionList(projectDir, limit);
        return JSON.stringify({ sessionID, directory: projectDir, limit: limit ?? null, ...result }, null, 2);
      },
    }),

    ctf_orch_session_read: tool({
      description: "Read recent messages from a session",
      args: {
        target_session_id: schema.string().min(1),
        message_limit: schema.number().int().positive().max(200).default(50),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const targetSessionID = args.target_session_id;
        const limit = args.message_limit;
        const result = await callSessionMessages(projectDir, targetSessionID, limit);
        const messages: Array<{ role: string; text: string }> = [];
        if (result.ok) {
          for (const msg of result.data) {
            if (!isRecord(msg)) continue;
            const role =
              typeof msg.role === "string"
                ? msg.role
                : isRecord(msg.info) && typeof msg.info.role === "string"
                  ? String(msg.info.role)
                  : "";
            const parts = Array.isArray(msg.parts) ? msg.parts : [];
            const text = parts
              .map((p: unknown) => (isRecord(p) && typeof p.text === "string" ? p.text : ""))
              .filter(Boolean)
              .join("\n")
              .trim();
            if (!text) continue;
            messages.push({ role: role || "unknown", text });
          }
        }
        return JSON.stringify(
          {
            sessionID,
            directory: projectDir,
            targetSessionID,
            messageLimit: limit,
            ok: result.ok,
            ...(result.ok ? { messages } : { reason: result.reason }),
          },
          null,
          2,
        );
      },
    }),

    ctf_orch_session_search: tool({
      description: "Search text in recent messages across sessions (best-effort)",
      args: {
        query: schema.string().min(1),
        max_sessions: schema.number().int().positive().max(200).default(25),
        message_limit: schema.number().int().positive().max(200).default(40),
        case_sensitive: schema.boolean().default(false),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const q = args.case_sensitive ? args.query : args.query.toLowerCase();
        const list = await callSessionList(projectDir, args.max_sessions);
        if (!list.ok) {
          return JSON.stringify({ sessionID, ok: false, reason: list.reason, directory: projectDir }, null, 2);
        }

        const sessionIDs: string[] = [];
        for (const item of list.data) {
          if (isRecord(item) && typeof item.id === "string" && item.id.trim().length > 0) {
            sessionIDs.push(item.id.trim());
          }
        }

        const hits: Array<{ sessionID: string; role: string; preview: string }> = [];
        for (const targetSessionID of sessionIDs.slice(0, args.max_sessions)) {
          const read = await callSessionMessages(projectDir, targetSessionID, args.message_limit);
          if (!read.ok) continue;
          for (const msg of read.data) {
            if (!isRecord(msg)) continue;
            const role =
              typeof msg.role === "string"
                ? msg.role
                : isRecord(msg.info) && typeof msg.info.role === "string"
                  ? String(msg.info.role)
                  : "";
            const parts = Array.isArray(msg.parts) ? msg.parts : [];
            const text = parts
              .map((p: unknown) => (isRecord(p) && typeof p.text === "string" ? p.text : ""))
              .filter(Boolean)
              .join("\n")
              .trim();
            if (!text) continue;
            const hay = args.case_sensitive ? text : text.toLowerCase();
            if (!hay.includes(q)) continue;
            hits.push({ sessionID: targetSessionID, role: role || "unknown", preview: text.slice(0, 300) });
            if (hits.length >= 200) break;
          }
          if (hits.length >= 200) break;
        }

        return JSON.stringify(
          {
            sessionID,
            ok: true,
            directory: projectDir,
            query: args.query,
            maxSessions: args.max_sessions,
            messageLimit: args.message_limit,
            hits,
          },
          null,
          2,
        );
      },
    }),

    ctf_orch_session_info: tool({
      description: "Get best-effort metadata for a single session",
      args: {
        target_session_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const targetSessionID = args.target_session_id;
        const list = await callSessionList(projectDir, 200);
        const found =
          list.ok && Array.isArray(list.data)
            ? list.data.find((item) => isRecord(item) && String(item.id ?? "") === targetSessionID)
            : null;
        return JSON.stringify(
          {
            sessionID,
            directory: projectDir,
            targetSessionID,
            ok: true,
            found: Boolean(found),
            item: found ?? null,
          },
          null,
          2,
        );
      },
    }),

    aegis_memory_save: tool({
      description: "Persist structured memory entities/relations to the local knowledge graph",
      args: {
        entities: schema
          .array(
            schema.object({
              name: schema.string().min(1),
              entityType: schema.string().min(1),
              observations: schema.array(schema.string().min(1)).optional(),
              tags: schema.array(schema.string().min(1)).optional(),
            }),
          )
          .default([]),
        relations: schema
          .array(
            schema.object({
              from: schema.string().min(1),
              to: schema.string().min(1),
              relationType: schema.string().min(1),
              tags: schema.array(schema.string().min(1)).optional(),
            }),
          )
          .default([]),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        if (!config.memory.enabled) {
          return JSON.stringify({ ok: false, reason: "memory disabled", sessionID }, null, 2);
        }
        const loaded = readGraph();
        if (!loaded.ok) {
          return JSON.stringify({ ok: false, reason: loaded.reason, sessionID }, null, 2);
        }
        const graph = loaded.graph;
        const now = new Date().toISOString();

        const createdEntities: string[] = [];
        const updatedEntities: string[] = [];
        for (const e of args.entities ?? []) {
          const name = e.name.trim();
          const entityType = e.entityType.trim();
          if (!name || !entityType) continue;
          const tags = Array.isArray(e.tags) ? e.tags.map((t) => t.trim()).filter(Boolean) : [];
          const obs = Array.isArray(e.observations) ? e.observations.map((o) => o.trim()).filter(Boolean) : [];

          let entity = graph.entities.find((x) => x.name === name);
          if (!entity) {
            entity = {
              id: `ent_${randomUUID()}`,
              name,
              entityType,
              tags,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              observations: [],
            };
            graph.entities.push(entity);
            createdEntities.push(name);
          } else {
            entity.entityType = entityType;
            entity.updatedAt = now;
            entity.deletedAt = null;
            entity.tags = [...new Set([...entity.tags, ...tags])];
            updatedEntities.push(name);
          }

          for (const content of obs) {
            const exists = entity.observations.some((o) => o.deletedAt === null && o.content === content);
            if (exists) continue;
            entity.observations.push({ id: `obs_${randomUUID()}`, content, createdAt: now, deletedAt: null });
            entity.updatedAt = now;
          }
        }

        const createdRelations: string[] = [];
        for (const r of args.relations ?? []) {
          const from = r.from.trim();
          const to = r.to.trim();
          const relationType = r.relationType.trim();
          if (!from || !to || !relationType) continue;
          const tags = Array.isArray(r.tags) ? r.tags.map((t) => t.trim()).filter(Boolean) : [];
          const exists = graph.relations.some(
            (x) => x.deletedAt === null && x.from === from && x.to === to && x.relationType === relationType,
          );
          if (exists) continue;
          graph.relations.push({
            id: `rel_${randomUUID()}`,
            from,
            to,
            relationType,
            tags,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
          createdRelations.push(`${from} ${relationType} ${to}`);
        }

        const persisted = writeGraph(graph);
        if (!persisted.ok) {
          return JSON.stringify({ ok: false, reason: persisted.reason, sessionID }, null, 2);
        }
        return JSON.stringify(
          {
            ok: true,
            sessionID,
            storageDir: config.memory.storage_dir,
            createdEntities,
            updatedEntities,
            createdRelations,
          },
          null,
          2,
        );
      },
    }),

    aegis_memory_search: tool({
      description: "Search the local knowledge graph for a query string",
      args: {
        query: schema.string().min(1),
        limit: schema.number().int().positive().max(100).default(20),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        if (!config.memory.enabled) {
          return JSON.stringify({ ok: false, reason: "memory disabled", sessionID }, null, 2);
        }
        const loaded = readGraph();
        if (!loaded.ok) {
          return JSON.stringify({ ok: false, reason: loaded.reason, sessionID }, null, 2);
        }
        const q = args.query.toLowerCase();
        const results: Array<{ id: string; name: string; entityType: string; match: string }> = [];
        for (const e of loaded.graph.entities) {
          if (e.deletedAt) continue;
          const nameHit = e.name.toLowerCase().includes(q);
          const typeHit = e.entityType.toLowerCase().includes(q);
          const obsHit = e.observations.find((o) => o.deletedAt === null && o.content.toLowerCase().includes(q));
          if (!nameHit && !typeHit && !obsHit) continue;
          const match = nameHit ? "name" : typeHit ? "entityType" : "observation";
          results.push({ id: e.id, name: e.name, entityType: e.entityType, match });
          if (results.length >= args.limit) break;
        }
        return JSON.stringify({ ok: true, sessionID, query: args.query, results }, null, 2);
      },
    }),

    aegis_memory_list: tool({
      description: "List entities in the local knowledge graph",
      args: {
        limit: schema.number().int().positive().max(200).default(50),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        if (!config.memory.enabled) {
          return JSON.stringify({ ok: false, reason: "memory disabled", sessionID }, null, 2);
        }
        const loaded = readGraph();
        if (!loaded.ok) {
          return JSON.stringify({ ok: false, reason: loaded.reason, sessionID }, null, 2);
        }
        const entities = loaded.graph.entities
          .filter((e) => !e.deletedAt)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, args.limit)
          .map((e) => ({
            id: e.id,
            name: e.name,
            entityType: e.entityType,
            tags: e.tags,
            updatedAt: e.updatedAt,
            observations: e.observations.filter((o) => o.deletedAt === null).length,
          }));
        return JSON.stringify({ ok: true, sessionID, entities }, null, 2);
      },
    }),

    aegis_memory_delete: tool({
      description: "Delete entities by name (soft delete by default)",
      args: {
        names: schema.array(schema.string().min(1)).default([]),
        hard_delete: schema.boolean().default(false),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        if (!config.memory.enabled) {
          return JSON.stringify({ ok: false, reason: "memory disabled", sessionID }, null, 2);
        }
        const loaded = readGraph();
        if (!loaded.ok) {
          return JSON.stringify({ ok: false, reason: loaded.reason, sessionID }, null, 2);
        }
        const graph = loaded.graph;
        const now = new Date().toISOString();
        const targets = new Set(args.names.map((n) => n.trim()).filter(Boolean));
        let deleted = 0;
        if (args.hard_delete) {
          const before = graph.entities.length;
          graph.entities = graph.entities.filter((e) => !targets.has(e.name));
          deleted = before - graph.entities.length;
        } else {
          for (const e of graph.entities) {
            if (!targets.has(e.name)) continue;
            if (e.deletedAt) continue;
            e.deletedAt = now;
            e.updatedAt = now;
            deleted += 1;
          }
        }
        const persisted = writeGraph(graph);
        if (!persisted.ok) {
          return JSON.stringify({ ok: false, reason: persisted.reason, sessionID }, null, 2);
        }
        return JSON.stringify({ ok: true, sessionID, deleted }, null, 2);
      },
    }),

    aegis_think: tool({
      description: "Record structured step-by-step reasoning to durable notes",
      args: {
        thought: schema.string().min(1),
        nextThoughtNeeded: schema.boolean(),
        thoughtNumber: schema.number().int().min(1),
        totalThoughts: schema.number().int().min(1),
        isRevision: schema.boolean().optional(),
        revisesThought: schema.number().int().min(1).optional(),
        branchFromThought: schema.number().int().min(1).optional(),
        branchId: schema.string().min(1).optional(),
        needsMoreThoughts: schema.boolean().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!config.sequential_thinking.enabled) {
          return JSON.stringify({ ok: false, reason: "sequential thinking disabled", sessionID }, null, 2);
        }
        const state = ensureThinkState(sessionID);
        const adjustedTotal = Math.max(state.totalThoughts, args.totalThoughts, args.thoughtNumber);
        state.totalThoughts = adjustedTotal;
        state.thoughtHistoryLength += 1;
        if (args.branchId && typeof args.branchFromThought === "number") {
          state.branches.add(args.branchId);
        }
        const recorded = appendThinkRecord(sessionID, {
          tool: config.sequential_thinking.tool_name,
          thought: args.thought,
          nextThoughtNeeded: args.nextThoughtNeeded,
          thoughtNumber: args.thoughtNumber,
          totalThoughts: adjustedTotal,
          isRevision: args.isRevision ?? false,
          revisesThought: args.revisesThought ?? null,
          branchFromThought: args.branchFromThought ?? null,
          branchId: args.branchId ?? null,
          needsMoreThoughts: args.needsMoreThoughts ?? null,
        });
        if (!recorded.ok) {
          return JSON.stringify({ ok: false, reason: recorded.reason, sessionID }, null, 2);
        }
        return JSON.stringify(
          {
            thoughtNumber: args.thoughtNumber,
            totalThoughts: adjustedTotal,
            nextThoughtNeeded: args.nextThoughtNeeded,
            branches: [...state.branches],
            thoughtHistoryLength: state.thoughtHistoryLength,
          },
          null,
          2,
        );
      },
    }),


    ctf_orch_postmortem: tool({
      description: "Summarize failure reasons and suggest next adaptive route",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        const decision = route(state, config);
        const topReasons = FAILURE_REASON_VALUES.map((reason) => ({
          reason,
          count: state.failureReasonCounts[reason],
        }))
          .filter((item) => item.count > 0)
          .sort((a, b) => b.count - a.count);

        const recommendation =
          state.lastFailureReason === "verification_mismatch"
            ? state.verifyFailCount >= (config.stuck_threshold ?? 2)
              ? "Repeated verification mismatch: treat as decoy/constraint mismatch and pivot via stuck route."
              : "Route through ctf-decoy-check then ctf-verify for candidate validation."
            : state.lastFailureReason === "tooling_timeout" || state.lastFailureReason === "context_overflow"
              ? "Use failover/compaction path and reduce output/context size before retry."
              : state.lastFailureReason === "hypothesis_stall"
                ? "Pivot hypothesis immediately and run cheapest disconfirm test next."
                : state.lastFailureReason === "exploit_chain"
                  ? "Stabilize exploit chain with deterministic repro artifacts before rerun."
                  : state.lastFailureReason === "environment"
                    ? "Fix runtime environment/tool availability before continuing exploitation."
                    : "No recent classified failure reason; continue normal route.";

        return JSON.stringify(
          {
            sessionID,
            lastFailureReason: state.lastFailureReason,
            lastFailureSummary: state.lastFailureSummary,
            lastFailedRoute: state.lastFailedRoute,
            lastFailureAt: state.lastFailureAt,
            topReasons,
            recommendation,
            nextDecision: decision,
          },
          null,
          2
        );
      },
    }),

    ctf_orch_failover: tool({
      description: "Resolve fallback agent name from original agent + error text",
      args: {
        agent: schema.string(),
        error: schema.string(),
      },
      execute: async (args) => {
        const fallback = resolveFailoverAgent(args.agent, args.error, config.failover);
        return JSON.stringify({ original: args.agent, fallback: fallback ?? "NONE" }, null, 2);
      },
    }),

    ctf_orch_check_budgets: tool({
      description: "Check markdown budget overflows in runtime notes",
      args: {},
      execute: async () => {
        const issues = notesStore.checkBudgets();
        return JSON.stringify({ ok: issues.length === 0, issues }, null, 2);
      },
    }),

    ctf_orch_compact: tool({
      description: "Compact/rotate markdown notes that exceed budget limits",
      args: {},
      execute: async () => {
        const actions = notesStore.compactNow();
        return JSON.stringify({ actions }, null, 2);
      },
    }),

    ctf_orch_readiness: tool({
      description: "Check subagent/MCP mappings and notes writability readiness",
      args: {},
      execute: async () => {
        const report = buildReadinessReport(projectDir, notesStore, config);
        return JSON.stringify(report, null, 2);
      },
    }),

    ctf_orch_doctor: tool({
      description:
        "Diagnose environment/provider/model readiness (providers, models, and Aegis/OpenCode config cohesion)",
      args: {
        include_models: schema.boolean().optional(),
        max_models: schema.number().int().positive().optional(),
      },
      execute: async (args) => {
        const includeModels = args.include_models === true;
        const maxModels = args.max_models ?? 10;

        const readiness = buildReadinessReport(projectDir, notesStore, config);
        const providerResult = await callConfigProviders(projectDir);
        const claude = getClaudeCompatibilityReport();

        const usedModels = extractAgentModels(readiness.checkedConfigPath);
        const usedProviders = [...new Set(usedModels.map(providerIdFromModel).filter(Boolean))];

        const providerSummary =
          providerResult.ok && providerResult.data
            ? (providerResult.data.providers as Array<Record<string, unknown>>).map((p) => {
                const id = typeof p.id === "string" ? p.id : "";
                const name = typeof p.name === "string" ? p.name : "";
                const source = typeof p.source === "string" ? p.source : "";
                const env = Array.isArray(p.env) ? p.env : [];
                const modelsObj = isRecord(p.models) ? p.models : {};
                const modelKeys = Object.keys(modelsObj);
                return {
                  id,
                  name,
                  source,
                  env,
                  modelCount: modelKeys.length,
                  models: includeModels ? modelKeys.slice(0, maxModels) : undefined,
                };
              })
            : [];

        const availableProviderIds = new Set(providerSummary.map((p) => p.id).filter(Boolean));
        const missingProviders = usedProviders.filter((pid) => pid && !availableProviderIds.has(pid));

        const modelLookup = new Map<string, Set<string>>();
        for (const p of providerSummary) {
          if (!p.id) continue;
          const models = new Set<string>();
          if (Array.isArray(p.models)) {
            for (const m of p.models) {
              if (typeof m === "string" && m) models.add(m);
            }
          }
          modelLookup.set(p.id, models);
        }

        const missingModels: Array<{ model: string; reason: string }> = [];
        if (includeModels) {
          for (const m of usedModels) {
            const pid = providerIdFromModel(m);
            const mid = modelIdFromModel(m);
            const models = modelLookup.get(pid);
            if (!models) {
              continue;
            }
            if (models.has(m) || (mid && models.has(mid))) {
              continue;
            }
            missingModels.push({
              model: m,
              reason: `model id not found in provider '${pid}' (checked '${m}' and '${mid}')`,
            });
          }
        }

        return JSON.stringify(
          {
            readiness,
            claude,
            providers: providerResult.ok
              ? { ok: true, count: providerSummary.length, providers: providerSummary }
              : { ok: false, reason: providerResult.reason },
            agentModels: {
              usedModels,
              usedProviders,
              missingProviders,
              missingModels,
            },
          },
          null,
          2
        );
      },
    }),

    ctf_orch_slash: tool({
      description: "Run an OpenCode slash workflow by submitting a synthetic prompt",
      args: {
        command: schema.enum(["init-deep", "refactor", "start-work", "ralph-loop", "ulw-loop"]),
        arguments: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const command = args.command;
        const extra = (args.arguments ?? "").trim();
        const text = extra ? `/${command} ${extra}` : `/${command}`;
        const result = await callPromptAsync(sessionID, text, {
          source: "oh-my-Aegis.slash",
          command,
        });
        return JSON.stringify({ sessionID, command, text, ...result }, null, 2);
      },
    }),

    ctf_orch_claude_skill_list: tool({
      description: "List available .claude skills and legacy commands in this project",
      args: {},
      execute: async (_args, context) => {
        const sessionID = context.sessionID;
        const listed = listClaudeSkillsAndCommands();
        return JSON.stringify({ sessionID, ...listed }, null, 2);
      },
    }),

    ctf_orch_claude_skill_run: tool({
      description: "Run a .claude skill/command by submitting its template as a synthetic prompt",
      args: {
        name: schema.string().min(1),
        arguments: schema.array(schema.string()).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const argv = Array.isArray(args.arguments) ? args.arguments : [];
        const loaded = loadClaudeSkillOrCommand(args.name);
        if (!loaded.ok) {
          return JSON.stringify({ ok: false, reason: loaded.reason, sessionID, name: args.name }, null, 2);
        }
        const rendered = renderSkillTemplate(loaded.text, argv);
        const result = await callPromptAsync(sessionID, rendered, {
          source: "oh-my-Aegis.claude-skill",
          kind: loaded.kind,
          name: args.name,
        });
        return JSON.stringify({ sessionID, name: args.name, kind: loaded.kind, path: loaded.path, ...result }, null, 2);
      },
    }),

    ctf_orch_exploit_template_list: tool({
      description: "List built-in exploit templates (PWN/CRYPTO)",
      args: {
        domain: schema.enum(["PWN", "CRYPTO", "WEB", "REV", "FORENSICS"]).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const domain = args.domain as ("PWN" | "CRYPTO" | "WEB" | "REV" | "FORENSICS" | undefined);
        const templates = listExploitTemplates(domain);
        return JSON.stringify({ sessionID, domain: domain ?? "ALL", templates }, null, 2);
      },
    }),

    ctf_orch_exploit_template_get: tool({
      description: "Get a built-in exploit template by id",
      args: {
        domain: schema.enum(["PWN", "CRYPTO"]),
        id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const entry = getExploitTemplate(args.domain as "PWN" | "CRYPTO", args.id);
        if (!entry) {
          return JSON.stringify({ ok: false, reason: "template not found", sessionID, domain: args.domain, id: args.id }, null, 2);
        }
        return JSON.stringify({ ok: true, sessionID, template: entry }, null, 2);
      },
    }),

    ctf_auto_triage: tool({
      description: "Auto-triage a challenge file: detect type, suggest target, generate scan commands",
      args: {
        file_path: schema.string().min(1),
        file_output: schema.string().optional(),
      },
      execute: async (args) => {
        const result = triageFile(args.file_path, args.file_output);
        return JSON.stringify(result, null, 2);
      },
    }),

    ctf_flag_scan: tool({
      description: "Scan text for flag patterns and return candidates",
      args: {
        text: schema.string().min(1),
        source: schema.string().default("manual"),
        custom_pattern: schema.string().optional(),
      },
      execute: async (args) => {
        if (args.custom_pattern) {
          setCustomFlagPattern(args.custom_pattern);
        }
        const found = scanForFlags(args.text, args.source);
        return JSON.stringify({
          found,
          alert: found.length > 0 ? buildFlagAlert(found) : null,
          allCandidates: getCandidates(),
        }, null, 2);
      },
    }),

    ctf_pattern_match: tool({
      description: "Match known CTF/security patterns in text",
      args: {
        text: schema.string().min(1),
        target_type: schema.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"]).optional(),
      },
      execute: async (args) => {
        const targetType = args.target_type as import("../state/types").TargetType | undefined;
        const matches = matchPatterns(args.text, targetType);
        return JSON.stringify({
          matches,
          summary: matches.length > 0 ? buildPatternSummary(matches) : "No patterns matched.",
        }, null, 2);
      },
    }),

    ctf_recon_pipeline: tool({
      description: "Plan a multi-phase BOUNTY recon pipeline for a target",
      args: {
        target: schema.string().min(1),
        scope: schema.array(schema.string()).optional(),
        templates: schema.string().optional(),
      },
      execute: async (args, context) => {
        const state = store.get(context.sessionID);
        const pipeline = planReconPipeline(state, config, args.target, { scope: args.scope });
        return JSON.stringify({ pipeline, templates: args.templates ?? null }, null, 2);
      },
    }),

    ctf_delta_scan: tool({
      description: "Save/query/compare scan snapshots for delta-aware scanning",
      args: {
        action: schema.enum(["save", "query", "should_rescan"]),
        target: schema.string().min(1),
        template_set: schema.string().default("default"),
        findings: schema.array(schema.string()).optional(),
        hosts: schema.array(schema.string()).optional(),
        ports: schema.array(schema.number()).optional(),
        max_age_ms: schema.number().optional(),
      },
      execute: async (args) => {
        if (args.action === "save") {
          const snapshot: ScanSnapshot = {
            id: randomUUID(),
            target: args.target,
            templateSet: args.template_set,
            timestamp: Date.now(),
            assets: [
              ...(args.hosts ?? []),
              ...((args.ports ?? []).map((p) => `port:${String(p)}`)),
            ],
            findings: args.findings ?? [],
          };
          saveScanSnapshot(snapshot);
          return JSON.stringify({ ok: true, saved: snapshot }, null, 2);
        }
        if (args.action === "query") {
          const current: ScanSnapshot = {
            id: randomUUID(),
            target: args.target,
            templateSet: args.template_set,
            timestamp: Date.now(),
            assets: [
              ...(args.hosts ?? []),
              ...((args.ports ?? []).map((p) => `port:${String(p)}`)),
            ],
            findings: args.findings ?? [],
          };
          const latest = getLatestSnapshot(args.target);
          const delta = latest ? computeDelta(latest, current) : null;
          const summary = buildDeltaSummary(args.target, {
            ...current,
          });
          return JSON.stringify({ ok: true, summary, latest, delta }, null, 2);
        }
        if (args.action === "should_rescan") {
          const rescan = shouldRescan(args.target, args.template_set, args.max_age_ms);
          return JSON.stringify({ ok: true, shouldRescan: rescan }, null, 2);
        }
        return JSON.stringify({ ok: false, reason: "unknown action" }, null, 2);
      },
    }),

    ctf_tool_recommend: tool({
      description: "Get recommended security tools for a target type",
      args: {
        target_type: schema.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"]),
      },
      execute: async (args) => {
        const tools = recommendedTools(args.target_type as import("../state/types").TargetType);
        return JSON.stringify({ tools }, null, 2);
      },
    }),

    ctf_libc_lookup: tool({
      description: "Lookup libc versions from leaked function addresses",
      args: {
        lookups: schema.array(schema.object({
          symbol: schema.string().min(1),
          address: schema.string().min(1),
        })),
        compute_base_leaked_address: schema.string().optional(),
        compute_base_symbol_offset: schema.number().optional(),
      },
      execute: async (args) => {
        const requests: LibcLookupRequest[] = args.lookups.map(l => ({
          symbolName: l.symbol,
          address: l.address,
        }));
        const result = localLookup(requests);
        const summary = buildLibcSummary(result);
        const libcRipUrl = buildLibcRipUrl(requests);
        let base: string | null = null;
        if (args.compute_base_leaked_address && typeof args.compute_base_symbol_offset === "number") {
          base = computeLibcBase(args.compute_base_leaked_address, args.compute_base_symbol_offset);
        }
        return JSON.stringify({ result, summary, libcRipUrl, computedBase: base }, null, 2);
      },
    }),

    ctf_env_parity: tool({
      description: "Check environment parity between local and remote for PWN challenges",
      args: {
        dockerfile_content: schema.string().optional(),
        ldd_output: schema.string().optional(),
        binary_path: schema.string().optional(),
      },
      execute: async (args) => {
        const remote: Partial<EnvInfo> = {};
        if (args.dockerfile_content) {
          Object.assign(remote, parseDockerfile(args.dockerfile_content));
        }
        const local: Partial<EnvInfo> = {};
        if (args.ldd_output) {
          const parsed = parseLddOutput(args.ldd_output);
          if (parsed) {
            local.libcVersion = parsed.version;
            local.libcPath = parsed.libcPath;
          }
        }
        const report = buildParityReport(local, remote);
        const summary = buildParitySummary(report);
        const localCommands = localEnvCommands();
        return JSON.stringify({ report, summary, localCommands }, null, 2);
      },
    }),

    ctf_report_generate: tool({
      description: "Generate a CTF writeup or BOUNTY report from session notes",
      args: {
        mode: schema.enum(["CTF", "BOUNTY"]),
        challenge_name: schema.string().default("Challenge"),
        worklog: schema.string().default(""),
        evidence: schema.string().default(""),
        target_type: schema.string().optional(),
        flag: schema.string().optional(),
      },
      execute: async (args) => {
        const reportOptions: Record<string, string> = {
          challengeName: args.challenge_name,
          programName: args.challenge_name,
        };
        if (args.target_type) {
          reportOptions.category = args.target_type;
          reportOptions.endpoint = args.target_type;
        }
        if (args.flag) {
          reportOptions.flag = args.flag;
        }
        const report = generateReport(
          args.mode as "CTF" | "BOUNTY",
          args.worklog,
          args.evidence,
          reportOptions,
        );
        const markdown = formatReportMarkdown(report);
        return JSON.stringify({ report, markdown }, null, 2);
      },
    }),

    ctf_subagent_dispatch: tool({
      description: "Plan a dispatch for aegis-explore or aegis-librarian subagent",
      args: {
        query: schema.string().min(1),
        type: schema.enum(["explore", "librarian", "auto"]).default("auto"),
      },
      execute: async (args, context) => {
        const state = store.get(context.sessionID);
        const agentType = args.type === "auto" ? detectSubagentType(args.query) : args.type;
        const plan = agentType === "explore"
          ? planExploreDispatch(state, args.query)
          : planLibrarianDispatch(state, args.query);
        return JSON.stringify({ agentType, plan }, null, 2);
      },
    }),

    ctf_orch_pty_create: tool({
      description: "Create a PTY session for interactive workflows",
      args: {
        command: schema.string().min(1),
        args: schema.array(schema.string()).optional(),
        cwd: schema.string().optional(),
        title: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const body: Record<string, unknown> = {
          command: args.command,
        };
        if (args.args) body.args = args.args;
        if (args.cwd) body.cwd = args.cwd;
        if (args.title) body.title = args.title;
        const result = await callPtyCreate(projectDir, body);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_list: tool({
      description: "List PTY sessions for this project",
      args: {},
      execute: async (_args, context) => {
        const sessionID = context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyList(projectDir);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_get: tool({
      description: "Get a PTY session by id",
      args: {
        pty_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyGet(projectDir, args.pty_id);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_update: tool({
      description: "Update a PTY session (title/size)",
      args: {
        pty_id: schema.string().min(1),
        title: schema.string().optional(),
        rows: schema.number().int().positive().optional(),
        cols: schema.number().int().positive().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const body: Record<string, unknown> = {};
        if (args.title) body.title = args.title;
        if (args.rows && args.cols) {
          body.size = { rows: args.rows, cols: args.cols };
        }
        const result = await callPtyUpdate(projectDir, args.pty_id, body);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_remove: tool({
      description: "Remove (terminate) a PTY session",
      args: {
        pty_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyRemove(projectDir, args.pty_id);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_connect: tool({
      description: "Connect info for a PTY session",
      args: {
        pty_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyConnect(projectDir, args.pty_id);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    // ── Parallel CTF orchestration tools ──

    ctf_parallel_dispatch: tool({
      description:
        "Dispatch parallel child sessions for CTF scanning/hypothesis testing. " +
        "Creates N child sessions, each with a different agent/purpose, and sends prompts concurrently. " +
        "Use plan='scan' for initial parallel recon or plan='hypothesis' with hypotheses array.",
      args: {
        plan: schema.enum(["scan", "hypothesis", "deep_worker"]),
        challenge_description: schema.string().optional(),
        goal: schema.string().optional(),
        hypotheses: schema.string().optional(),
        max_tracks: schema.number().int().min(1).max(5).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const sessionClient = extractSessionClient(client);
        if (!sessionClient) {
          return JSON.stringify({
            ok: false,
            reason: "SDK session client not available (requires session.create + session.promptAsync)",
            sessionID,
          }, null, 2);
        }

        parallelBackgroundManager.bindSessionClient(sessionClient);

        const activeGroup = getActiveGroup(sessionID);
        if (activeGroup) {
          return JSON.stringify({
            ok: false,
            reason: "Active parallel group already exists. Use ctf_parallel_collect or ctf_parallel_abort first.",
            sessionID,
            activeGroup: groupSummary(activeGroup),
          }, null, 2);
        }

        const state = store.get(sessionID);
        const maxTracks = args.max_tracks ?? 3;

        let dispatchPlan: DispatchPlan;
        if (args.plan === "scan") {
          dispatchPlan = planScanDispatch(state, config, args.challenge_description ?? "");
        } else if (args.plan === "deep_worker") {
          const goal = (args.goal ?? args.challenge_description ?? "").trim();
          dispatchPlan = planDeepWorkerDispatch(state, config, goal);
        } else {
          let parsedHypotheses: Array<{ hypothesis: string; disconfirmTest: string }> = [];
          if (args.hypotheses) {
            try {
              const raw = JSON.parse(args.hypotheses);
              if (Array.isArray(raw)) {
                parsedHypotheses = raw
                  .filter((h: unknown) => h && typeof h === "object")
                  .map((h: Record<string, unknown>) => ({
                    hypothesis: String(h.hypothesis ?? h.h ?? ""),
                    disconfirmTest: String(h.disconfirmTest ?? h.disconfirm ?? h.test ?? ""),
                  }))
                  .filter((h) => h.hypothesis.length > 0);
              }
            } catch {
              return JSON.stringify({
                ok: false,
                reason: "Failed to parse hypotheses JSON. Expected: [{hypothesis, disconfirmTest}, ...]",
                sessionID,
              }, null, 2);
            }
          }
          if (parsedHypotheses.length === 0) {
            return JSON.stringify({
              ok: false,
              reason: "hypothesis plan requires at least one hypothesis in JSON array format",
              sessionID,
            }, null, 2);
          }
          dispatchPlan = planHypothesisDispatch(state, config, parsedHypotheses);
        }

        try {
          const group = await dispatchParallel(
            sessionClient,
            sessionID,
            projectDir,
            dispatchPlan,
            maxTracks,
            { parallel: config.parallel },
          );

          parallelBackgroundManager.ensurePolling();
          void parallelBackgroundManager.pollOnce();

          return JSON.stringify({
            ok: true,
            sessionID,
            dispatched: group.tracks.length,
            group: groupSummary(group),
          }, null, 2);
        } catch (error) {
          return JSON.stringify({
            ok: false,
            reason: `Dispatch error: ${error instanceof Error ? error.message : String(error)}`,
            sessionID,
          }, null, 2);
        }
      },
    }),

    ctf_parallel_status: tool({
      description:
        "Check the status of active parallel child sessions. " +
        "Shows each track's purpose, agent, and current status (running/completed/failed/aborted).",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const groups = getGroups(sessionID);
        if (groups.length === 0) {
          return JSON.stringify({
            ok: true,
            sessionID,
            hasActiveGroup: false,
            totalGroups: 0,
            message: "No parallel groups dispatched for this session.",
          }, null, 2);
        }

        const activeGroup = getActiveGroup(sessionID);
        return JSON.stringify({
          ok: true,
          sessionID,
          hasActiveGroup: Boolean(activeGroup),
          totalGroups: groups.length,
          activeGroup: activeGroup ? groupSummary(activeGroup) : null,
          completedGroups: groups
            .filter((g) => g.completedAt > 0)
            .map(groupSummary),
        }, null, 2);
      },
    }),

    ctf_parallel_collect: tool({
      description:
        "Collect results from parallel child sessions. " +
        "Reads messages from each track and returns their last assistant output. " +
        "Optionally declare a winner to abort the rest.",
      args: {
        winner_session_id: schema.string().optional(),
        message_limit: schema.number().int().min(1).max(20).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const sessionClient = extractSessionClient(client);
        if (!sessionClient) {
          return JSON.stringify({
            ok: false,
            reason: "SDK session client not available",
            sessionID,
          }, null, 2);
        }

        parallelBackgroundManager.bindSessionClient(sessionClient);
        await parallelBackgroundManager.pollOnce();

        const activeGroup = getActiveGroup(sessionID);
        if (!activeGroup) {
          const groups = getGroups(sessionID);
          if (groups.length === 0) {
            return JSON.stringify({
              ok: false,
              reason: "No parallel groups exist for this session.",
              sessionID,
            }, null, 2);
          }
          const lastGroup = groups[groups.length - 1];
          return JSON.stringify({
            ok: true,
            sessionID,
            alreadyCompleted: true,
            group: groupSummary(lastGroup),
          }, null, 2);
        }

        const messageLimit = args.message_limit ?? 5;
        const results = await collectResults(sessionClient, activeGroup, projectDir, messageLimit);

        if (args.winner_session_id) {
          const abortedCount = await abortAllExcept(
            sessionClient,
            activeGroup,
            args.winner_session_id,
            projectDir,
          );
          return JSON.stringify({
            ok: true,
            sessionID,
            winnerDeclared: args.winner_session_id,
            abortedTracks: abortedCount,
            group: groupSummary(activeGroup),
            results: results.map((r) => ({
              sessionID: r.sessionID,
              purpose: r.purpose,
              agent: r.agent,
              status: r.status,
              resultPreview: r.lastAssistantMessage.slice(0, 500),
            })),
          }, null, 2);
        }

        return JSON.stringify({
          ok: true,
          sessionID,
          group: groupSummary(activeGroup),
          results: results.map((r) => ({
            sessionID: r.sessionID,
            purpose: r.purpose,
            agent: r.agent,
            status: r.status,
            resultPreview: r.lastAssistantMessage.slice(0, 500),
          })),
        }, null, 2);
      },
    }),

    ctf_parallel_abort: tool({
      description:
        "Abort all running parallel child sessions. " +
        "Use when pivoting strategy or when a winner is found via ctf_parallel_collect.",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const sessionClient = extractSessionClient(client);
        if (!sessionClient) {
          return JSON.stringify({
            ok: false,
            reason: "SDK session client not available",
            sessionID,
          }, null, 2);
        }

        const activeGroup = getActiveGroup(sessionID);
        if (!activeGroup) {
          return JSON.stringify({
            ok: true,
            sessionID,
            message: "No active parallel group to abort.",
          }, null, 2);
        }

        const abortedCount = await abortAll(sessionClient, activeGroup, projectDir);
        return JSON.stringify({
          ok: true,
          sessionID,
          abortedTracks: abortedCount,
          group: groupSummary(activeGroup),
        }, null, 2);
      },
    }),
  };
}
