import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
import { buildReadinessReport } from "../config/readiness";
import { resolveFailoverAgent, route } from "../orchestration/router";
import {
  abortAll,
  abortAllExcept,
  collectResults,
  dispatchParallel,
  extractSessionClient,
  getActiveGroup,
  getGroups,
  groupSummary,
  planHypothesisDispatch,
  planScanDispatch,
  type DispatchPlan,
  type SessionClient,
} from "../orchestration/parallel";
import type { ParallelBackgroundManager } from "../orchestration/parallel-background";
import type { NotesStore } from "../state/notes-store";
import { type SessionStore } from "../state/session-store";
import { type FailureReason, type SessionEvent, type TargetType } from "../state/types";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
      const fallback = await (createFn as (args: unknown) => Promise<any>)({ directory, ...(body as any) });
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
      const fallback = await (updateFn as (args: unknown) => Promise<any>)({ ptyID, directory, ...(body as any) });
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

  return {
    ctf_orch_status: tool({
      description: "Get current CTF/BOUNTY orchestration state and route decision",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        const decision = route(state, config);
        return JSON.stringify({ sessionID, state, decision }, null, 2);
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
        return JSON.stringify({ sessionID, mode: state.mode }, null, 2);
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
        return JSON.stringify({ sessionID, state, decision: route(state, config) }, null, 2);
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

    ctf_orch_pty_create: tool({
      description: "Create a PTY session for interactive workflows (disabled by default)",
      args: {
        command: schema.string().min(1),
        args: schema.array(schema.string()).optional(),
        cwd: schema.string().optional(),
        title: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!config.interactive.enabled) {
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
      description: "List PTY sessions for this project (disabled by default)",
      args: {},
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        if (!config.interactive.enabled) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyList(projectDir);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_get: tool({
      description: "Get a PTY session by id (disabled by default)",
      args: {
        pty_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!config.interactive.enabled) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyGet(projectDir, args.pty_id);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_update: tool({
      description: "Update a PTY session (title/size) (disabled by default)",
      args: {
        pty_id: schema.string().min(1),
        title: schema.string().optional(),
        rows: schema.number().int().positive().optional(),
        cols: schema.number().int().positive().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!config.interactive.enabled) {
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
      description: "Remove (terminate) a PTY session (disabled by default)",
      args: {
        pty_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!config.interactive.enabled) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyRemove(projectDir, args.pty_id);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_connect: tool({
      description: "Connect info for a PTY session (disabled by default)",
      args: {
        pty_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!config.interactive.enabled) {
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
        plan: schema.enum(["scan", "hypothesis"]),
        challenge_description: schema.string().optional(),
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
