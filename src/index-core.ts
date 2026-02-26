import type { Plugin } from "@opencode-ai/plugin";
const _packageJson = await import("../package.json");
const AEGIS_VERSION = typeof _packageJson.version === "string" ? _packageJson.version : "0.0.0";
import type { AgentConfig, McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "./config/loader";
import { buildReadinessReport } from "./config/readiness";
import { createBuiltinMcps } from "./mcp";
import { buildTaskPlaybook, hasPlaybookMarker } from "./orchestration/playbook";
import { buildSignalGuidance, buildPhaseInstruction } from "./orchestration/signal-actions";
import { buildToolGuide } from "./orchestration/tool-guide";
import { decideAutoDispatch, isNonOverridableSubagent } from "./orchestration/task-dispatch";
import { isStuck, route } from "./orchestration/router";
import {
  agentModel,
  baseAgentName,
  resolveAgentExecutionProfile,
  isModelHealthy,
} from "./orchestration/model-health";
import { configureParallelPersistence, getActiveGroup } from "./orchestration/parallel";
import { loadScopePolicyFromWorkspace } from "./bounty/scope-policy";
import type { BountyScopePolicy, ScopeDocLoadResult } from "./bounty/scope-policy";
import { evaluateBashCommand, extractBashCommand } from "./risk/policy-matrix";
import {
  isTokenOrQuotaFailure,
  sanitizeCommand,
  classifyFailureReason,
  detectInjectionIndicators,
  detectInteractiveCommand,
  isContextLengthFailure,
  isLikelyTimeout,
  isRetryableTaskFailure,
  isVerifyFailure,
  isVerificationSourceRelevant,
  isVerifySuccess,
  hasVerifierEvidence,
  extractVerifierEvidence,
  hasVerifyOracleSuccess,
  hasExitCodeZeroEvidence,
  hasRuntimeEvidence,
  hasAcceptanceEvidence,
  assessRevVmRisk,
  assessDomainRisk,
  isLowConfidenceCandidate,
  sanitizeThinkingBlocks,
} from "./risk/sanitize";
import { appendEvidenceLedger, scoreEvidence, computeOracleProgress, type EvidenceEntry, type EvidenceType } from "./orchestration/evidence-ledger";
import { scanForFlags, buildFlagAlert, containsFlag, checkForDecoy, isReplayUnsafe } from "./orchestration/flag-detector";
import { NotesStore } from "./state/notes-store";
import { normalizeSessionID } from "./state/session-id";
import { SessionStore } from "./state/session-store";
import type { TargetType } from "./state/types";
import { createControlTools } from "./tools/control-tools";
import { ParallelBackgroundManager } from "./orchestration/parallel-background";
import { createAegisOrchestratorAgent } from "./agents/aegis-orchestrator";
import { createAegisPlanAgent } from "./agents/aegis-plan";
import { createAegisExecAgent } from "./agents/aegis-exec";
import { createAegisDeepAgent } from "./agents/aegis-deep";
import { createAegisExploreAgent } from "./agents/aegis-explore";
import { createAegisLibrarianAgent } from "./agents/aegis-librarian";
import { createSessionRecoveryManager } from "./recovery/session-recovery";
import { createContextWindowRecoveryManager } from "./recovery/context-window-recovery";
import { discoverAvailableSkills, mergeLoadSkills, resolveAutoloadSkills } from "./skills/autoload";
import { runClaudeHook } from "./hooks/claude-compat";
import { isRecord } from "./utils/is-record";
import {
  detectDockerParityRequirement,
  AegisPolicyDenyError,
  normalizeToolName,
  maskSensitiveToolOutput,
  isPathInsideRoot,
  truncateWithHeadTail,
  extractArtifactPathHints,
  isAegisManagerDelegationTool,
  inProgressTodoCount,
  todoStatusCounts,
  SYNTHETIC_START_TODO,
  SYNTHETIC_CONTINUE_TODO,
  SYNTHETIC_BREAKDOWN_PREFIX,
  todoContent,
  isSyntheticTodoContent,
  textFromParts,
  textFromUnknown,
  detectTargetType,
} from "./helpers/plugin-utils";
import { ClaudeRulesCache, type ClaudeRuleEntry } from "./helpers/claude-rules-cache";
import { normalizePathForMatch } from "./helpers/plugin-utils";

const OhMyAegisPlugin: Plugin = async (ctx) => {
  const configWarnings: string[] = [];
  const config = loadConfig(ctx.directory, { onWarning: (msg) => configWarnings.push(msg) });
  const availableSkills = discoverAvailableSkills(ctx.directory);

  let appendLatencySample: (sample: Record<string, unknown>) => void = () => { };

  const notesStore = new NotesStore(
    ctx.directory,
    config.markdown_budget,
    config.notes.root_dir,
    {
      asyncPersistence: true,
      flushDelayMs: 35,
      onFlush: (metric) => {
        appendLatencySample({
          kind: "notes.flush",
          ...metric,
        });
      },
    }
  );
  let notesReady = true;

  const latencyBuffer: string[] = [];
  let latencyFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushLatencyBuffer = (): void => {
    if (!notesReady || latencyBuffer.length === 0) {
      return;
    }
    try {
      const path = join(notesStore.getRootDirectory(), "latency.jsonl");
      const payload = latencyBuffer.join("");
      latencyBuffer.length = 0;
      appendFileSync(path, payload, "utf-8");
    } catch (error) {
      void error;
    }
  };

  appendLatencySample = (sample: Record<string, unknown>): void => {
    if (!notesReady) {
      return;
    }
    try {
      latencyBuffer.push(`${JSON.stringify({ at: new Date().toISOString(), ...sample })}\n`);
      if (latencyBuffer.length >= 128) {
        if (latencyFlushTimer) {
          clearTimeout(latencyFlushTimer);
          latencyFlushTimer = null;
        }
        flushLatencyBuffer();
        return;
      }
      if (!latencyFlushTimer) {
        latencyFlushTimer = setTimeout(() => {
          latencyFlushTimer = null;
          flushLatencyBuffer();
        }, 50);
        if (latencyFlushTimer && typeof (latencyFlushTimer as { unref?: () => void }).unref === "function") {
          (latencyFlushTimer as { unref: () => void }).unref();
        }
      }
    } catch (error) {
      void error;
    }
  };

  const softBashOverrideByCallId = new Map<string, { addedAt: number; reason: string; command: string }>();
  const SOFT_BASH_OVERRIDE_TTL_MS = 10 * 60_000;
  const pruneSoftBashOverrides = (): void => {
    const now = Date.now();
    for (const [callId, entry] of softBashOverrideByCallId.entries()) {
      if (now - entry.addedAt > SOFT_BASH_OVERRIDE_TTL_MS) {
        softBashOverrideByCallId.delete(callId);
      }
    }
    if (softBashOverrideByCallId.size <= 200) {
      return;
    }
    const entries = [...softBashOverrideByCallId.entries()].sort((a, b) => a[1].addedAt - b[1].addedAt);
    for (let i = 0; i < entries.length - 200; i += 1) {
      softBashOverrideByCallId.delete(entries[i][0]);
    }
  };

  const readContextByCallId = new Map<string, { sessionID: string; filePath: string }>();
  const injectedContextPathsBySession = new Map<string, Set<string>>();
  const activeAgentBySession = new Map<string, string>();
  const injectedContextPathsFor = (sessionID: string): Set<string> => {
    const existing = injectedContextPathsBySession.get(sessionID);
    if (existing) return existing;
    const created = new Set<string>();
    injectedContextPathsBySession.set(sessionID, created);
    return created;
  };

  const injectedClaudeRulePathsBySession = new Map<string, Set<string>>();
  const injectedClaudeRulePathsFor = (sessionID: string): Set<string> => {
    const existing = injectedClaudeRulePathsBySession.get(sessionID);
    if (existing) return existing;
    const created = new Set<string>();
    injectedClaudeRulePathsBySession.set(sessionID, created);
    return created;
  };

  const writeToolOutputArtifact = (params: {
    sessionID: string;
    tool: string;
    callID: string;
    title: string;
    output: string;
  }): string | null => {
    try {
      if (!notesReady) {
        return null;
      }
      const root = notesStore.getRootDirectory();
      const safeSessionID = normalizeSessionID(params.sessionID);
      const base = join(root, "artifacts", "tool-output", safeSessionID);
      mkdirSync(base, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `${stamp}_${normalizeToolName(params.tool)}_${normalizeToolName(params.callID)}.txt`;
      const path = join(base, fileName);
      const header = [
        `TITLE: ${params.title}`,
        `TOOL: ${params.tool}`,
        `SESSION: ${params.sessionID}`,
        `CALL: ${params.callID}`,
        "---",
        "",
      ].join("\n");
      writeFileSync(path, `${header}${params.output}\n`, "utf-8");
      return path;
    } catch {
      return null;
    }
  };

  const scopePolicyCache: {
    lastLoadAt: number;
    sourcePath: string | null;
    sourceMtimeMs: number;
    result: ScopeDocLoadResult;
  } = {
    lastLoadAt: 0,
    sourcePath: null,
    sourceMtimeMs: 0,
    result: { ok: false, reason: "not_loaded", warnings: [] },
  };

  const claudeRulesCacheInstance = new ClaudeRulesCache(ctx.directory);
  const getClaudeDenyRules = () => claudeRulesCacheInstance.getDenyRules();
  const getClaudeRules = () => claudeRulesCacheInstance.getRules();

  const safeNoteWrite = (label: string, action: () => void): void => {
    void label;
    if (!notesReady) {
      return;
    }
    try {
      action();
    } catch {
      notesReady = false;
    }
  };
  const HOT_PATH_LATENCY_TOOLS = new Set([
    "edit",
    "write",
    "aegis_memory_delete",
    "task",
    "todowrite",
    "bash",
  ]);
  const SLOW_HOOK_THRESHOLD_MS = 120;
  const maybeRecordHookLatency = (
    hook: "tool.execute.before" | "tool.execute.after",
    input: { tool: string; sessionID: string; callID: string },
    startedAt: bigint
  ): void => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const isHot = HOT_PATH_LATENCY_TOOLS.has(input.tool) || input.tool.startsWith("aegis_memory_");
    // debug.log_all_hooks가 활성화된 경우 threshold 무시
    const logAll = config.debug.log_all_hooks;
    if (!logAll && !isHot && durationMs < SLOW_HOOK_THRESHOLD_MS) {
      return;
    }

    appendLatencySample({
      kind: "hook",
      hook,
      tool: input.tool,
      sessionID: input.sessionID,
      callID: input.callID,
      durationMs: Number(durationMs.toFixed(3)),
    });

    if (durationMs >= SLOW_HOOK_THRESHOLD_MS * 2) {
      safeNoteWrite("latency.hook", () => {
        notesStore.recordScan(
          `Slow hook detected: hook=${hook} tool=${input.tool} duration_ms=${durationMs.toFixed(1)} session=${input.sessionID}`
        );
      });
    }
  };
  const noteHookError = (label: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    safeNoteWrite(label, () => {
      notesStore.recordScan(`hook-error ${label}: ${message}`);
    });
  };
  const runClaudeCompatHookOrThrow = async (
    hookName: "PreToolUse" | "PostToolUse",
    payload: Record<string, unknown>
  ): Promise<void> => {
    const result = await runClaudeHook({
      projectDir: ctx.directory,
      hookName,
      payload,
      timeoutMs: 5_000,
    });
    if (!result.ok) {
      throw new AegisPolicyDenyError(result.reason);
    }
  };
  const runClaudeCompatHookBestEffort = async (
    hookName: "PreToolUse" | "PostToolUse",
    payload: Record<string, unknown>
  ): Promise<void> => {
    const result = await runClaudeHook({
      projectDir: ctx.directory,
      hookName,
      payload,
      timeoutMs: 5_000,
    });
    if (!result.ok) {
      safeNoteWrite("claude.hook", () => {
        notesStore.recordScan(`Claude hook ${hookName} soft-fail: ${result.reason}`);
      });
      notesStore.flushNow();
    }
  };
  try {
    notesStore.ensureFiles();
  } catch {
    notesReady = false;
  }

  if (configWarnings.length > 0) {
    safeNoteWrite("config.warnings", () => {
      for (const w of configWarnings.slice(0, 20)) {
        notesStore.recordScan(`Config warning: ${w}`);
      }
      if (configWarnings.length > 20) {
        notesStore.recordScan(`Config warning: (${configWarnings.length - 20} more warnings omitted)`);
      }
    });
  }

  const autoCompactLastAtBySession = new Map<string, number>();
  const AUTO_COMPACT_MIN_INTERVAL_MS = 60_000;
  const maybeAutoCompactNotes = (sessionID: string, reason: string): void => {
    if (!config.recovery.enabled || !config.recovery.auto_compact_on_context_failure) {
      return;
    }
    const now = Date.now();
    const last = autoCompactLastAtBySession.get(sessionID) ?? 0;
    if (now - last < AUTO_COMPACT_MIN_INTERVAL_MS) {
      return;
    }
    autoCompactLastAtBySession.set(sessionID, now);
    let actions: string[] = [];
    try {
      actions = notesStore.compactNow();
    } catch {
      actions = [];
    }
    safeNoteWrite("recovery.compact", () => {
      notesStore.recordScan(`Auto compact ran: reason=${reason} actions=${actions.join("; ") || "(none)"}`);
    });
  };

  const toastLastAtBySessionKey = new Map<string, number>();
  const maybeShowToast = async (params: {
    sessionID: string;
    key: string;
    title: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
    durationMs?: number;
  }): Promise<void> => {
    if (!config.tui_notifications.enabled) {
      return;
    }
    const toastFn = (ctx.client as any)?.tui?.showToast;
    if (typeof toastFn !== "function") {
      return;
    }
    const now = Date.now();
    const throttleMs = config.tui_notifications.throttle_ms;
    const mapKey = `${params.sessionID}:${params.key}`;
    const last = toastLastAtBySessionKey.get(mapKey) ?? 0;
    if (throttleMs > 0 && now - last < throttleMs) {
      return;
    }
    toastLastAtBySessionKey.set(mapKey, now);

    const title = params.title.slice(0, 80);
    const message = params.message.slice(0, 240);
    const duration = params.durationMs ?? 4_000;
    try {
      await toastFn({
        directory: ctx.directory,
        title,
        message,
        variant: params.variant,
        duration,
      });
      return;
    } catch (error) {
      void error;
    }
    try {
      await toastFn({
        query: { directory: ctx.directory },
        body: {
          title,
          message,
          variant: params.variant,
          duration,
        },
      });
    } catch (error) {
      void error;
    }
  };

  const sendSessionPromptAsync = async (sessionID: string, text: string, metadata: Record<string, unknown>) => {
    const promptAsync = (ctx.client as unknown as { session?: { promptAsync?: unknown } } | null)?.session
      ?.promptAsync;
    if (typeof promptAsync !== "function") {
      return false;
    }

    const payload = {
      parts: [
        {
          type: "text",
          text,
          synthetic: true,
          metadata,
        },
      ],
    };

    const fn = promptAsync as (args: unknown) => Promise<unknown>;
    const attempts: unknown[] = [
      { path: { id: sessionID }, body: payload },
      { query: { id: sessionID }, body: payload },
      { sessionID, body: payload },
    ];

    for (const args of attempts) {
      try {
        await fn(args);
        return true;
      } catch {
      }
    }

    return false;
  };

  const maybeAutoloopTick = async (sessionID: string, trigger: string): Promise<void> => {
    if (!config.auto_loop.enabled) {
      return;
    }
    const state = store.get(sessionID);
    if (!state.modeExplicit) {
      return;
    }
    if (!state.autoLoopEnabled) {
      return;
    }
    if (config.auto_loop.only_when_ultrawork && !state.ultraworkEnabled) {
      return;
    }
    if (config.auto_loop.stop_on_verified && state.mode === "CTF" && state.latestVerified.trim().length > 0) {
      store.setAutoLoopEnabled(sessionID, false);
      safeNoteWrite("autoloop.stop", () => {
        notesStore.recordScan("Auto loop stopped: submission accepted evidence present.");
      });
      await maybeShowToast({
        sessionID,
        key: "autoloop_stop_verified",
        title: "oh-my-Aegis: autoloop stopped",
        message: "Verified output present; autoloop disabled.",
        variant: "info",
      });
      return;
    }

    const now = Date.now();
    if (state.autoLoopLastPromptAt > 0 && now - state.autoLoopLastPromptAt < config.auto_loop.idle_delay_ms) {
      return;
    }

    if (state.autoLoopIterations >= config.auto_loop.max_iterations) {
      store.setAutoLoopEnabled(sessionID, false);
      safeNoteWrite("autoloop.stop", () => {
        notesStore.recordScan(
          `Auto loop stopped: max iterations reached (${config.auto_loop.max_iterations}).`
        );
      });
      return;
    }

    const decision = route(state, config);
    const iteration = state.autoLoopIterations + 1;
    const promptText = [
      "[oh-my-Aegis auto-loop]",
      `trigger=${trigger} iteration=${iteration}`,
      `next_route=${decision.primary}`,
      "Rules:",
      "- Build/update a short execution plan first, then reflect it in todowrite.",
      "- Keep 2-6 TODO items when possible; allow multiple pending items but only one in_progress.",
      "- Execute via the next_route (use the task tool once).",
      "- Record progress with ctf_orch_event and stop this turn.",
    ].join("\n");

    const promptAvailable =
      typeof (ctx.client as unknown as { session?: { promptAsync?: unknown } } | null)?.session?.promptAsync ===
      "function";
    if (!promptAvailable) {
      store.setAutoLoopEnabled(sessionID, false);
      safeNoteWrite("autoloop.error", () => {
        notesStore.recordScan("Auto loop disabled: client.session.promptAsync unavailable.");
      });
      return;
    }

    store.recordAutoLoopPrompt(sessionID);
    safeNoteWrite("autoloop.tick", () => {
      notesStore.recordScan(`Auto loop tick: session=${sessionID} route=${decision.primary} (${trigger})`);
    });

    try {
      const sent = await sendSessionPromptAsync(sessionID, promptText, {
        source: "oh-my-Aegis.auto-loop",
        iteration,
        next_route: decision.primary,
      });
      if (sent) {
        return;
      }
      store.setAutoLoopEnabled(sessionID, false);
      safeNoteWrite("autoloop.error", () => {
        notesStore.recordScan("Auto loop disabled: failed to send promptAsync.");
      });
      noteHookError("autoloop", new Error("promptAsync failed for all supported payload shapes"));
    } catch (error) {
      store.setAutoLoopEnabled(sessionID, false);
      safeNoteWrite("autoloop.error", () => {
        notesStore.recordScan("Auto loop disabled: failed to send promptAsync.");
      });
      noteHookError("autoloop", error);
    }
  };

  const getBountyScopePolicy = (): BountyScopePolicy | null => {
    const now = Date.now();
    if (now - scopePolicyCache.lastLoadAt < 60_000) {
      return scopePolicyCache.result.ok ? scopePolicyCache.result.policy : null;
    }
    scopePolicyCache.lastLoadAt = now;
    const result = loadScopePolicyFromWorkspace(ctx.directory, {
      candidates: config.bounty_policy.scope_doc_candidates,
      includeApexForWildcardAllow: config.bounty_policy.include_apex_for_wildcard_allow,
    });
    scopePolicyCache.result = result;
    if (result.ok) {
      const changed =
        scopePolicyCache.sourcePath !== result.policy.sourcePath ||
        scopePolicyCache.sourceMtimeMs !== result.policy.sourceMtimeMs;
      scopePolicyCache.sourcePath = result.policy.sourcePath;
      scopePolicyCache.sourceMtimeMs = result.policy.sourceMtimeMs;
      if (changed) {
        safeNoteWrite("scope.policy", () => {
          notesStore.recordScan(
            `Scope doc loaded: ${result.policy.sourcePath} (allow=${result.policy.allowedHostsExact.length + result.policy.allowedHostsSuffix.length}, deny=${result.policy.deniedHostsExact.length + result.policy.deniedHostsSuffix.length}, blackout=${result.policy.blackoutWindows.length})`
          );
          for (const w of result.policy.warnings) {
            notesStore.recordScan(`Scope doc warning: ${w}`);
          }
        });
      }
      return result.policy;
    }
    return null;
  };

  const store = new SessionStore(
    ctx.directory,
    ({ sessionID, state, reason }) => {
      safeNoteWrite("observer", () => {
        notesStore.recordChange(sessionID, state, reason, route(state, config));
      });
    },
    config.default_mode,
    config.notes.root_dir,
    {
      asyncPersistence: true,
      flushDelayMs: 25,
      onPersist: (metric) => {
        appendLatencySample({
          kind: "session.persist",
          ...metric,
        });
      },
    }
  );

  const appendOrchestrationMetric = (entry: Record<string, unknown>): void => {
    if (!notesReady) {
      return;
    }
    try {
      const path = join(notesStore.getRootDirectory(), "metrics.json");
      let parsed: unknown = [];
      if (existsSync(path)) {
        try {
          parsed = JSON.parse(readFileSync(path, "utf-8"));
        } catch {
          parsed = [];
        }
      }
      const list = Array.isArray(parsed) ? parsed : [];
      list.push(entry);
      writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`, "utf-8");
    } catch (error) {
      noteHookError("metrics.append", error);
    }
  };

  const appendLedgerFromRuntime = (
    sessionID: string,
    event: string,
    evidenceType: EvidenceType,
    confidence: number,
    summary: string,
    source: string
  ): void => {
    if (!notesReady) return;
    const entry: EvidenceEntry = {
      at: new Date().toISOString(),
      sessionID,
      event,
      evidenceType,
      confidence,
      summary: summary.replace(/\s+/g, " ").trim().slice(0, 240),
      source,
    };
    appendEvidenceLedger(notesStore.getRootDirectory(), entry);
    const scored = scoreEvidence([entry]);
    store.setCandidateLevel(sessionID, scored.level);
  };

  const sessionRecoveryManager = createSessionRecoveryManager({
    client: ctx.client,
    directory: ctx.directory,
    notesStore,
    config,
    store,
  });

  const contextWindowRecoveryManager = createContextWindowRecoveryManager({
    client: ctx.client,
    directory: ctx.directory,
    notesStore,
    config,
    store,
    getDefaultModel: (sessionID: string) => {
      const state = store.get(sessionID);
      const model =
        state.lastTaskModel.trim().length > 0
          ? state.lastTaskModel.trim()
          : state.lastTaskSubagent
            ? agentModel(state.lastTaskSubagent)
            : undefined;
      return model ?? agentModel("aegis-exec");
    },
  });

  if (!config.enabled) {
    return {};
  }

  configureParallelPersistence(ctx.directory, config.notes.root_dir);

  const parallelBackgroundManager = new ParallelBackgroundManager({
    client: ctx.client,
    directory: ctx.directory,
    config,
  });
  const controlTools = createControlTools(
    store,
    notesStore,
    config,
    ctx.directory,
    ctx.client,
    parallelBackgroundManager,
  );
  const readiness = buildReadinessReport(ctx.directory, notesStore, config);
  if (notesReady && (!readiness.ok || readiness.warnings.length > 0)) {
    const entries: string[] = [];
    if (readiness.checkedConfigPath) {
      entries.push(`config=${readiness.checkedConfigPath}`);
    }
    if (readiness.issues.length > 0) {
      entries.push(`issues=${readiness.issues.join("; ")}`);
    }
    if (readiness.warnings.length > 0) {
      entries.push(`warnings=${readiness.warnings.join("; ")}`);
    }
    safeNoteWrite("readiness", () => {
      notesStore.recordScan(`Readiness check: ${entries.join(" | ")}`);
    });
  }

  return {
    event: async ({ event }) => {
      try {
        if (!event || typeof event !== "object") {
          return;
        }
        const e = event as { type?: string; properties?: Record<string, unknown> };
        const type = typeof e.type === "string" ? e.type : "";
        const props = e.properties ?? {};

        parallelBackgroundManager.handleEvent(type, props);

        await sessionRecoveryManager.handleEvent(type, props);
        await contextWindowRecoveryManager.handleEvent(type, props);

        if (type === "session.created") {
          if (config.tui_notifications.startup_toast) {
            const info = props.info as { id?: string; parentID?: string } | undefined;
            const sessionID = typeof info?.id === "string" ? info.id : "";
            // Only show on top-level (non-child) sessions
            if (sessionID && !info?.parentID) {
              await maybeShowToast({
                sessionID,
                key: "startup",
                title: `oh-my-Aegis ${AEGIS_VERSION}`,
                message: "Aegis is orchestrating your workflow.",
                variant: "info",
                durationMs: 4_000,
              });
            }
          }
          return;
        }

        if (type === "session.idle") {
          const sessionID = typeof props.sessionID === "string" ? props.sessionID : "";
          if (sessionID) {
            await maybeAutoloopTick(sessionID, "session.idle");
          }
          return;
        }

        if (type === "session.status") {
          const sessionID = typeof props.sessionID === "string" ? props.sessionID : "";
          const status = props.status as { type?: string } | undefined;
          if (sessionID && status?.type === "idle") {
            await maybeAutoloopTick(sessionID, "session.status idle");
          }
        }
      } catch (error) {
        noteHookError("event", error);
      }
    },

    config: async (runtimeConfig) => {
      try {
        if (config.enable_builtin_mcps) {
          type McpConfig = McpLocalConfig | McpRemoteConfig;
          type McpMap = Record<string, McpConfig>;

          const existingMcp: McpMap = runtimeConfig.mcp ?? {};
          const builtinMcps: McpMap = createBuiltinMcps({
            projectDir: ctx.directory,
            disabledMcps: config.disabled_mcps,
            memoryStorageDir: config.memory.storage_dir,
          });

          const merged: McpMap = {
            ...builtinMcps,
            ...existingMcp,
          };

          const builtinMemory = (builtinMcps as Record<string, McpConfig | undefined>)["memory"];
          if (builtinMemory) {
            const existingMemory = (existingMcp as Record<string, McpConfig | undefined>)["memory"];
            const env =
              existingMemory && existingMemory.type === "local" && existingMemory.environment
                ? existingMemory.environment
                : null;
            const filePath = env && typeof env.MEMORY_FILE_PATH === "string" ? env.MEMORY_FILE_PATH : "";
            const keepExisting = Boolean(filePath) && isAbsolute(filePath) && isPathInsideRoot(filePath, ctx.directory);
            if (!keepExisting) {
              merged.memory = builtinMemory;
            }
          }

          runtimeConfig.mcp = merged;
        }

        const existingAgents = isRecord(runtimeConfig.agent)
          ? (runtimeConfig.agent as Record<string, AgentConfig | undefined>)
          : ({} as Record<string, AgentConfig | undefined>);
        const defaultModel = typeof runtimeConfig.model === "string" ? runtimeConfig.model : undefined;
        const nextAgents: Record<string, AgentConfig | undefined> = { ...existingAgents };
        const ensureHiddenInternalSubagent = (name: string, factory: () => AgentConfig): void => {
          const current = nextAgents[name];
          if (isRecord(current)) {
            nextAgents[name] = { ...(current as AgentConfig), mode: "subagent", hidden: true };
            return;
          }
          const seeded = factory();
          nextAgents[name] = { ...seeded, mode: "subagent", hidden: true };
        };

        const existingAegis = nextAgents.Aegis;
        if (isRecord(existingAegis)) {
          const existingPermission = isRecord((existingAegis as Record<string, unknown>).permission)
            ? ((existingAegis as Record<string, unknown>).permission as Record<string, unknown>)
            : {};
          nextAgents.Aegis = {
            ...(existingAegis as AgentConfig),
            mode: "primary",
            hidden: false,
            permission: {
              ...existingPermission,
              edit: "deny",
              bash: "deny",
              webfetch: "deny",
              external_directory: "deny",
              doom_loop: "deny",
            },
          };
        } else {
          nextAgents.Aegis = createAegisOrchestratorAgent(defaultModel);
        }
        ensureHiddenInternalSubagent("aegis-plan", () => createAegisPlanAgent(defaultModel));
        ensureHiddenInternalSubagent("aegis-exec", () => createAegisExecAgent(defaultModel));
        ensureHiddenInternalSubagent("aegis-deep", () => createAegisDeepAgent(defaultModel));
        ensureHiddenInternalSubagent("aegis-explore", () => createAegisExploreAgent());
        ensureHiddenInternalSubagent("aegis-librarian", () => createAegisLibrarianAgent());

        runtimeConfig.agent = nextAgents;
      } catch (error) {
        noteHookError("config", error);
      }
    },

    tool: {
      ...controlTools,
    },

    "chat.message": async (input, output) => {
      try {
        if (typeof input.agent === "string" && input.agent.trim().length > 0) {
          activeAgentBySession.set(input.sessionID, baseAgentName(input.agent.trim()).toLowerCase());
        }
        const state = store.get(input.sessionID);

        const role = (output.message as unknown as { role?: string } | undefined)?.role;
        const isUserMessage = role === "user";
        let ultraworkEnabled = state.ultraworkEnabled;

        const messageText = textFromParts(output.parts as unknown[]);
        const contextText = [textFromUnknown(input), messageText].filter(Boolean).join("\n");

        if (isUserMessage && /\b(ultrawork|ulw)\b/i.test(contextText)) {
          store.setUltraworkEnabled(input.sessionID, true);
          store.setAutoLoopEnabled(input.sessionID, true);
          ultraworkEnabled = true;
          safeNoteWrite("ultrawork.enabled", () => {
            notesStore.recordScan("Ultrawork enabled by keyword in user prompt.");
          });
        }

        if (isUserMessage) {
          const ultrathinkRe = /(^|\n)\s*ultrathink\s*(\n|$)/i;
          const thinkRe = /(^|\n)\s*(think-mode|think\s+mode|think)\s*(\n|$)/i;
          if (ultrathinkRe.test(messageText)) {
            store.setThinkMode(input.sessionID, "ultrathink");
            safeNoteWrite("thinkmode", () => {
              notesStore.recordScan("Think mode set by user keyword: ultrathink.");
            });
          } else if (thinkRe.test(messageText)) {
            store.setThinkMode(input.sessionID, "think");
            safeNoteWrite("thinkmode", () => {
              notesStore.recordScan("Think mode set by user keyword: think.");
            });
          }
        }

        if (config.enable_injection_logging && notesReady) {
          const indicators = detectInjectionIndicators(contextText);
          if (indicators.length > 0) {
            safeNoteWrite("chat.message.injection", () => {
              notesStore.recordInjectionAttempt("chat.message", indicators, contextText);
            });
            notesStore.flushNow();
          }
        }
        const modeMatch = messageText.match(/\bMODE\s*:\s*(CTF|BOUNTY)\b/i);
        if (modeMatch) {
          store.setMode(input.sessionID, modeMatch[1].toUpperCase() as "CTF" | "BOUNTY");
        } else if (isUserMessage) {
          if (/\bctf\b/i.test(messageText)) {
            store.setMode(input.sessionID, "CTF");
          } else if (/\bbounty\b/i.test(messageText)) {
            store.setMode(input.sessionID, "BOUNTY");
          }
        } else if (config.enforce_mode_header) {
          const parts = output.parts as Array<Record<string, unknown>>;
          parts.unshift({
            type: "text",
            text: `MODE: ${state.mode}`,
          });
        }

        if (config.target_detection.enabled) {
          const lockAfterFirst = config.target_detection.lock_after_first;
          const onlyInScan = config.target_detection.only_in_scan;
          const canSetTarget =
            (!onlyInScan || state.phase === "SCAN") && (!lockAfterFirst || state.targetType === "UNKNOWN");
          if (canSetTarget) {
            const target = detectTargetType(contextText);
            if (target) {
              store.setTargetType(input.sessionID, target);
            }
          }
        }

        if (state.mode === "CTF" && (state.targetType === "PWN" || state.targetType === "REV")) {
          const parityRequirement = detectDockerParityRequirement(ctx.directory);
          if (parityRequirement.required) {
            store.setEnvParityRequired(input.sessionID, true, parityRequirement.reason);
          }
        }

        const freeTextSignalsEnabled = config.allow_free_text_signals || ultraworkEnabled;
        if (freeTextSignalsEnabled) {
          const blockedSignals = [
            "scan_completed",
            "plan_completed",
            "candidate_found",
            "verify_success",
            "verify_fail",
            "submit_accepted",
            "submit_rejected",
          ];
          const blockedDetected = blockedSignals.filter((signal) =>
            new RegExp(`\\b${signal}\\b`, "i").test(messageText)
          );
          if (blockedDetected.length > 0) {
            safeNoteWrite("chat.message.free_text_blocked", () => {
              notesStore.recordScan(
                `Free-text state transition signals ignored: ${blockedDetected.join(", ")}. Use ctf_orch_event/tool verification path instead.`
              );
            });
          }
          if (/\bno_new_evidence\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "no_new_evidence");
          }
          if (/\bsame_payload_(repeat|repeated)\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "same_payload_repeat");
          }
          if (/\bnew_evidence\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "new_evidence");
          }
          if (/\breadonly_inconclusive\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "readonly_inconclusive");
          }
          if (/\breset_loop\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "reset_loop");
          }
        }
      } catch (error) {
        noteHookError("chat.message", error);
      }

    },

    "chat.params": async (input) => {
      try {
        if (typeof input.agent === "string" && input.agent.trim().length > 0) {
          activeAgentBySession.set(input.sessionID, baseAgentName(input.agent.trim()).toLowerCase());
        }
      } catch (error) {
        noteHookError("chat.params", error);
      }
    },

    "tool.execute.before": async (input, output) => {
      const hookStartedAt = process.hrtime.bigint();
      try {
        await runClaudeCompatHookOrThrow("PreToolUse", {
          session_id: input.sessionID,
          call_id: input.callID,
          tool_name: input.tool,
          tool_input: isRecord(output.args) ? output.args : {},
        });

        const stateForGate = store.get(input.sessionID);
        const callerAgentFromInput =
          typeof (input as { agent?: unknown }).agent === "string"
            ? baseAgentName(((input as { agent?: string }).agent ?? "").trim()).toLowerCase()
            : "";
        const callerAgent = callerAgentFromInput || activeAgentBySession.get(input.sessionID) || "";
        const isAegisOrCtfTool = input.tool.startsWith("ctf_") || input.tool.startsWith("aegis_");
        const modeActivationBypassTools = new Set(["ctf_orch_set_mode", "ctf_orch_status"]);
        if (!stateForGate.modeExplicit && isAegisOrCtfTool && !modeActivationBypassTools.has(input.tool)) {
          throw new AegisPolicyDenyError(
            "oh-my-Aegis is inactive until mode is explicitly declared. Use `MODE: CTF`, `MODE: BOUNTY`, or run `ctf_orch_set_mode` first."
          );
        }

        if (callerAgent === "aegis" && !isAegisManagerDelegationTool(input.tool)) {
          throw new AegisPolicyDenyError(
            `Aegis manager cannot execute '${input.tool}' directly. Delegate analysis/execution to subagents via task (with explicit subagent_type) and review results via orchestration tools.`
          );
        }

        if (input.tool === "todowrite") {
          const state = store.get(input.sessionID);
          const args = isRecord(output.args) ? output.args : {};
          const todos = Array.isArray(args.todos) ? args.todos : [];
          args.todos = todos;

          if (config.enforce_todo_single_in_progress) {
            const count = inProgressTodoCount(args);
            if (count > 1) {
              let seen = false;
              for (const todo of todos) {
                if (!isRecord(todo) || todo.status !== "in_progress") {
                  continue;
                }
                if (!seen) {
                  seen = true;
                  continue;
                }
                todo.status = "pending";
              }
              safeNoteWrite("todowrite.guard", () => {
                notesStore.recordScan("Normalized todowrite payload: only one in_progress item is allowed.");
              });
            }
          }

          if (config.enforce_todo_flow_non_scan && state.phase !== "SCAN") {
            const terminalCtfSuccess = state.mode === "CTF" && state.latestVerified.trim().length > 0;
            const minTodos = Math.max(1, Math.floor(config.todo_min_items_non_scan));
            let syntheticDedupChanged = false;

            let seenContinue = false;
            for (let i = todos.length - 1; i >= 0; i -= 1) {
              const content = todoContent(todos[i]);
              if (content !== SYNTHETIC_CONTINUE_TODO) {
                continue;
              }
              if (!seenContinue) {
                seenContinue = true;
                continue;
              }
              todos.splice(i, 1);
              syntheticDedupChanged = true;
            }

            if (syntheticDedupChanged) {
              safeNoteWrite("todowrite.flow", () => {
                notesStore.recordScan(
                  "Todo flow enforced (non-SCAN): deduplicated repeated synthetic continuation TODO entries."
                );
              });
            }

            const nonSyntheticCount = todos.filter((todo) => {
              if (!isRecord(todo)) return false;
              return !isSyntheticTodoContent(todoContent(todo));
            }).length;

            if (!terminalCtfSuccess && todos.length === 0) {
              todos.push({
                content: SYNTHETIC_START_TODO,
                status: "in_progress",
                priority: "high",
              });
            }

            const shouldEnforceGranularity = todos.length === 0 || nonSyntheticCount > 0;
            if (
              !terminalCtfSuccess &&
              config.enforce_todo_granularity_non_scan &&
              shouldEnforceGranularity &&
              todos.length < minTodos
            ) {
              const missing = minTodos - todos.length;
              const existingSyntheticBreakdownCount = todos.filter((todo) =>
                todoContent(todo).startsWith(SYNTHETIC_BREAKDOWN_PREFIX)
              ).length;
              for (let i = 0; i < missing; i += 1) {
                todos.push({
                  content: `${SYNTHETIC_BREAKDOWN_PREFIX}${existingSyntheticBreakdownCount + i + 1}.`,
                  status: "pending",
                  priority: "medium",
                });
              }
              safeNoteWrite("todowrite.granularity", () => {
                notesStore.recordScan(
                  `Todo granularity enforced (non-SCAN): expanded todo set to at least ${minTodos} items.`
                );
              });
            }

            const counts = todoStatusCounts(todos);
            if (!terminalCtfSuccess && counts.pending > 0 && counts.inProgress === 0) {
              for (const todo of todos) {
                if (!isRecord(todo) || todo.status !== "pending") {
                  continue;
                }
                todo.status = "in_progress";
                break;
              }
              safeNoteWrite("todowrite.flow", () => {
                notesStore.recordScan(
                  "Todo flow enforced (non-SCAN): promoted next pending item to in_progress after completion update."
                );
              });
            }

            const finalCounts = todoStatusCounts(todos);
            if (!terminalCtfSuccess && finalCounts.open === 0 && todos.length > 0) {
              let activatedExistingContinue = false;
              for (const todo of todos) {
                if (!isRecord(todo) || todoContent(todo) !== SYNTHETIC_CONTINUE_TODO) {
                  continue;
                }
                todo.status = "in_progress";
                todo.priority = "high";
                activatedExistingContinue = true;
                break;
              }

              if (!activatedExistingContinue && nonSyntheticCount > 0) {
                todos.push({
                  content: SYNTHETIC_CONTINUE_TODO,
                  status: "in_progress",
                  priority: "high",
                });
              }

              if (activatedExistingContinue || nonSyntheticCount > 0) {
                safeNoteWrite("todowrite.flow", () => {
                  notesStore.recordScan(
                    "Todo flow enforced (non-SCAN): prevented terminal closure without an active next TODO step."
                  );
                });
              }
            }
          }

          if (
            state.ultraworkEnabled &&
            state.mode === "CTF" &&
            state.latestVerified.trim().length === 0
          ) {
            const hasOpenTodo = todos.some(
              (todo) =>
                isRecord(todo) &&
                (todo.status === "pending" || todo.status === "in_progress")
            );

            if (!hasOpenTodo) {
              const decision = route(state, config);
              todos.push({
                content: `Continue CTF loop via '${decision.primary}' until submit_accepted (no early stop).`,
                status: "pending",
                priority: "high",
              });
              safeNoteWrite("todowrite.continuation", () => {
                notesStore.recordScan(
                  `Todo continuation enforced (ultrawork): added pending item for route '${decision.primary}'.`
                );
              });
            }
          }

          output.args = args;
          return;
        }

        if (input.tool === "read") {
          const args = isRecord(output.args) ? output.args : {};
          const filePath = typeof args.filePath === "string" ? args.filePath : "";
          if (filePath) {
            const rules = getClaudeDenyRules();
            if (rules.denyRead.length > 0) {
              const resolvedTarget = isAbsolute(filePath) ? resolve(filePath) : resolve(ctx.directory, filePath);
              const normalized = normalizePathForMatch(resolvedTarget);
              const denied = rules.denyRead.find((rule) => rule.re.test(normalized));
              if (denied) {
                throw new AegisPolicyDenyError(`Claude settings denied Read: ${denied.raw}`);
              }
            }
            readContextByCallId.set(input.callID, { sessionID: input.sessionID, filePath });
          }
        }

        if (input.tool === "edit" || input.tool === "write") {
          const args = isRecord(output.args) ? output.args : {};
          const pathKeys = ["filePath", "path", "file", "filename"];
          let filePath = "";
          for (const key of pathKeys) {
            const value = args[key];
            if (typeof value === "string" && value.trim().length > 0) {
              filePath = value.trim();
              break;
            }
          }
          if (filePath) {
            const rules = getClaudeDenyRules();
            if (rules.denyEdit.length > 0) {
              const resolvedTarget = isAbsolute(filePath) ? resolve(filePath) : resolve(ctx.directory, filePath);
              const normalized = normalizePathForMatch(resolvedTarget);
              const denied = rules.denyEdit.find((rule) => rule.re.test(normalized));
              if (denied) {
                throw new AegisPolicyDenyError(`Claude settings denied Edit: ${denied.raw}`);
              }
            }
          }
        }

        if (input.tool === "task") {
          const state = store.get(input.sessionID);
          const args = (output.args ?? {}) as Record<string, unknown>;
          const explicitSubagentProvided =
            typeof args.subagent_type === "string" && args.subagent_type.trim().length > 0;
          if (callerAgent === "aegis-exec" && !explicitSubagentProvided) {
            throw new AegisPolicyDenyError(
              "Aegis Exec task calls must include explicit subagent_type to avoid recursive self-dispatch."
            );
          }
          if (!state.modeExplicit) {
            output.args = args;
            return;
          }
          const SESSION_CONTEXT_MARKER = "[oh-my-Aegis session-context]";
          const existingPrompt = typeof args.prompt === "string" ? args.prompt : "";
          const promptWithDefault =
            existingPrompt.trim().length > 0
              ? existingPrompt
              : "Continue orchestration by following the active mode and phase.";
          if (!promptWithDefault.includes(SESSION_CONTEXT_MARKER)) {
            const sessionContextLines = [
              SESSION_CONTEXT_MARKER,
              `MODE: ${state.mode}`,
              `PHASE: ${state.phase}`,
              `TARGET: ${state.targetType}`,
            ];
            if (state.mode === "BOUNTY") {
              sessionContextLines.push(state.scopeConfirmed ? "scope_confirmed" : "scope_unconfirmed");
            }
            args.prompt = `${sessionContextLines.join("\n")}\n\n${promptWithDefault}`;
          } else {
            args.prompt = promptWithDefault;
          }
          const decision = route(state, config);

          const routePinned = isNonOverridableSubagent(decision.primary);
          const userCategory = typeof args.category === "string" ? args.category : "";
          const userSubagent = typeof args.subagent_type === "string" ? args.subagent_type : "";
          let dispatchModel = "";

          const AUTO_PARALLEL_MARKER = "[oh-my-Aegis auto-parallel]";
          const hasAutoParallelMarker = typeof args.prompt === "string" && args.prompt.includes(AUTO_PARALLEL_MARKER);
          const activeParallelGroup = getActiveGroup(input.sessionID);
          const hasUserTaskOverride =
            (typeof args.subagent_type === "string" && args.subagent_type.trim().length > 0) ||
            (typeof args.category === "string" && args.category.trim().length > 0) ||
            (typeof args.model === "string" && args.model.trim().length > 0) ||
            (typeof args.variant === "string" && args.variant.trim().length > 0);
          const ctfScanRouteSet = new Set(
            Object.values(config.routing.ctf.scan).map((name) => baseAgentName(String(name)))
          );
          const bountyScanRouteSet = new Set(
            Object.values(config.routing.bounty.scan).map((name) => baseAgentName(String(name)))
          );
          const basePrimary = baseAgentName(decision.primary);
          const hasPrimaryProfileOverride = Boolean(state.subagentProfileOverrides[basePrimary]);
          const alternatives = state.alternatives
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
            .slice(0, 3);

          const isCtfParallelScanCandidate =
            state.mode === "CTF" && ctfScanRouteSet.has(basePrimary);
          const isBountyParallelScanCandidate =
            state.mode === "BOUNTY" && state.scopeConfirmed && bountyScanRouteSet.has(basePrimary);

          const shouldAutoParallelScan =
            config.parallel.auto_dispatch_scan &&
            (isCtfParallelScanCandidate || isBountyParallelScanCandidate) &&
            state.phase === "SCAN" &&
            !state.pendingTaskFailover &&
            state.taskFailoverCount === 0 &&
            !hasUserTaskOverride &&
            !hasPrimaryProfileOverride &&
            !activeParallelGroup &&
            !hasAutoParallelMarker;

          const shouldAutoParallelHypothesis =
            config.parallel.auto_dispatch_hypothesis &&
            state.mode === "CTF" &&
            state.phase !== "SCAN" &&
            basePrimary === "ctf-hypothesis" &&
            !state.pendingTaskFailover &&
            !hasUserTaskOverride &&
            alternatives.length >= 2 &&
            !activeParallelGroup &&
            !hasAutoParallelMarker;

          const shouldAutoParallelDeepWorker =
            state.mode === "CTF" &&
            (state.targetType === "REV" || state.targetType === "PWN") &&
            state.phase === "EXECUTE" &&
            !state.pendingTaskFailover &&
            state.taskFailoverCount === 0 &&
            !hasUserTaskOverride &&
            !hasPrimaryProfileOverride &&
            !activeParallelGroup &&
            !hasAutoParallelMarker;

          const autoParallelForced =
            shouldAutoParallelScan || shouldAutoParallelHypothesis || shouldAutoParallelDeepWorker;

          if (autoParallelForced) {
            const userPrompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
            const basePrompt = userPrompt.length > 0 ? userPrompt : "Continue CTF orchestration with delegated tracks.";

            if (shouldAutoParallelScan) {
              const autoParallelMode = state.mode === "BOUNTY" ? "BOUNTY" : "CTF";
              const safetyLine =
                state.mode === "BOUNTY"
                  ? "- Keep actions scope-safe and minimal-impact during scan tracks."
                  : "- Do not run direct domain execution before dispatch.";
              args.prompt = [
                basePrompt,
                "",
                AUTO_PARALLEL_MARKER,
                `mode=${autoParallelMode} phase=SCAN`,
                "- Immediately run ctf_parallel_dispatch plan=scan with challenge_description derived from available context.",
                safetyLine,
                "- While tracks run, check ctf_parallel_status and then merge with ctf_parallel_collect.",
                "- Choose winner when clear, then update plan + TODO list (multiple todos allowed, one in_progress).",
              ].join("\n");
            } else if (shouldAutoParallelHypothesis) {
              const hypothesesPayload = JSON.stringify(
                alternatives.map((hypothesis) => ({
                  hypothesis,
                  disconfirmTest: "Run one cheapest disconfirm test and return verifier-aligned evidence.",
                }))
              );
              args.prompt = [
                basePrompt,
                "",
                AUTO_PARALLEL_MARKER,
                "mode=CTF phase=PLAN_OR_EXECUTE",
                "- Immediately run ctf_parallel_dispatch plan=hypothesis with the provided hypotheses JSON.",
                `- hypotheses=${hypothesesPayload}`,
                "- While tracks run, check ctf_parallel_status and then merge with ctf_parallel_collect.",
                "- Declare winner if clear, then update plan + TODO list (multiple todos allowed, one in_progress).",
              ].join("\n");
            } else {
              const goal =
                typeof args.prompt === "string" && args.prompt.trim().length > 0
                  ? args.prompt.trim().slice(0, 2000)
                  : `Deep parallel analysis for ${state.targetType} in EXECUTE phase.`;
              args.prompt = [
                basePrompt,
                "",
                AUTO_PARALLEL_MARKER,
                "mode=CTF phase=EXECUTE",
                `- Immediately run ctf_parallel_dispatch plan=deep_worker goal=${JSON.stringify(goal)}.`,
                "- Launch static and dynamic tracks in parallel and collect with ctf_parallel_collect.",
                "- Pick winner when clear, then update TODO list and proceed with one in_progress item.",
              ].join("\n");
            }

            args.subagent_type = "aegis-deep";
            if ("category" in args) {
              delete args.category;
            }
            store.setLastTaskCategory(input.sessionID, "aegis-deep");
            store.setLastDispatch(input.sessionID, decision.primary, "aegis-deep");
            safeNoteWrite("task.auto_parallel", () => {
              notesStore.recordScan(
                `Auto parallel dispatch armed: session=${input.sessionID} scan=${shouldAutoParallelScan} hypothesis=${shouldAutoParallelHypothesis} deep_worker=${shouldAutoParallelDeepWorker}`
              );
            });
          }

          if (config.auto_dispatch.enabled && !autoParallelForced) {
            const dispatch = decideAutoDispatch(
              decision.primary,
              state,
              config.auto_dispatch.max_failover_retries,
              config
            );
            dispatchModel = typeof dispatch.model === "string" ? dispatch.model.trim() : "";
            const hasUserCategory = typeof args.category === "string" && args.category.length > 0;
            const hasUserSubagent =
              typeof args.subagent_type === "string" && args.subagent_type.length > 0;
            const shouldForceFailover = state.pendingTaskFailover;
            const hasUserDispatch = hasUserCategory || hasUserSubagent;
            const shouldSetSubagent =
              Boolean(dispatch.subagent_type) &&
              (routePinned ||
                shouldForceFailover ||
                !config.auto_dispatch.preserve_user_category ||
                !hasUserDispatch);

            if (dispatch.subagent_type && shouldSetSubagent) {
              const forced = routePinned ? decision.primary : dispatch.subagent_type;
              if (routePinned && (userCategory || userSubagent) && (userSubagent !== forced || userCategory)) {
                safeNoteWrite("task.pin", () => {
                  notesStore.recordScan(
                    `policy-pin task: route=${decision.primary} mode=${state.mode} scopeConfirmed=${state.scopeConfirmed} user_category=${userCategory || "(none)"} user_subagent=${userSubagent || "(none)"}`
                  );
                });
              }
              args.subagent_type = forced;
              if ("category" in args) {
                delete args.category;
              }
              store.setLastTaskCategory(input.sessionID, forced);
              store.setLastDispatch(input.sessionID, decision.primary, forced);

              if (shouldForceFailover) {
                store.consumeTaskFailover(input.sessionID);
              }
            }

            const requestedAgent =
              typeof args.subagent_type === "string" && args.subagent_type.length > 0
                ? args.subagent_type
                : typeof args.category === "string" && args.category.length > 0
                  ? args.category
                  : "";
            if (requestedAgent) {
              store.setLastTaskCategory(input.sessionID, requestedAgent);
              store.setLastDispatch(input.sessionID, decision.primary, requestedAgent);
            }

            if (typeof args.prompt === "string") {
              const tail = `\n\n[oh-my-Aegis auto-dispatch] ${dispatch.reason}`;
              if (!args.prompt.includes("[oh-my-Aegis auto-dispatch]")) {
                args.prompt = `${args.prompt}${tail}`;
              }
            }
          }

          if (!config.auto_dispatch.enabled && routePinned) {
            if ((userCategory || userSubagent) && (userSubagent !== decision.primary || userCategory)) {
              safeNoteWrite("task.pin", () => {
                notesStore.recordScan(
                  `policy-pin task: route=${decision.primary} mode=${state.mode} scopeConfirmed=${state.scopeConfirmed} user_category=${userCategory || "(none)"} user_subagent=${userSubagent || "(none)"}`
                );
              });
            }
            args.subagent_type = decision.primary;
            if ("category" in args) {
              delete args.category;
            }
            store.setLastTaskCategory(input.sessionID, decision.primary);
            store.setLastDispatch(input.sessionID, decision.primary, decision.primary);
          }

          if (typeof args.prompt === "string" && !hasPlaybookMarker(args.prompt)) {
            args.prompt = `${args.prompt}\n\n${buildTaskPlaybook(state, config)}`;
          }

          const categoryRequested = typeof args.category === "string" ? args.category.trim() : "";
          const subagentRequested = typeof args.subagent_type === "string" ? args.subagent_type.trim() : "";
          if (!subagentRequested && categoryRequested) {
            args.subagent_type = categoryRequested;
            if ("category" in args) {
              delete args.category;
            }
          }

          const THINKING_MODEL_ID = "openai/gpt-5.2";
          const rawRequested = typeof args.subagent_type === "string" ? args.subagent_type.trim() : "";
          const requested = baseAgentName(rawRequested);
          if (requested && rawRequested !== requested) {
            args.subagent_type = requested;
          }
          const thinkMode = state.thinkMode;
          const MAX_AUTO_DEEPEN_PER_SESSION = 3;
          const autoDeepenCount = state.recentEvents.filter((e) => e === "auto_deepen_applied").length;
          const shouldAutoDeepen =
            state.mode === "CTF" &&
            isStuck(state, config) &&
            autoDeepenCount < MAX_AUTO_DEEPEN_PER_SESSION;
          const shouldUltrathink = thinkMode === "ultrathink";
          const shouldThink =
            thinkMode === "think" &&
            (state.phase === "PLAN" || decision.primary === "ctf-hypothesis" || decision.primary === "deep-plan");

          const userPreferredModel = typeof args.model === "string" ? args.model.trim() : "";
          const userPreferredVariant = typeof args.variant === "string" ? args.variant.trim() : "";

          let preferredModel = dispatchModel;
          let preferredVariant = "";
          let thinkProfileApplied = false;
          if (requested && (shouldUltrathink || shouldThink || shouldAutoDeepen)) {
            if (!isNonOverridableSubagent(requested) && isModelHealthy(state, THINKING_MODEL_ID, config.dynamic_model.health_cooldown_ms)) {
              preferredModel = THINKING_MODEL_ID;
              preferredVariant = "xhigh";
              thinkProfileApplied = true;
              if (shouldAutoDeepen) {
                state.recentEvents.push("auto_deepen_applied");
                if (state.recentEvents.length > 30) {
                  state.recentEvents = state.recentEvents.slice(-30);
                }
              }
              safeNoteWrite("thinkmode.apply", () => {
                notesStore.recordScan(
                  `Think mode profile applied: subagent=${requested}, model=${THINKING_MODEL_ID}, variant=${preferredVariant} (mode=${thinkMode} stuck=${shouldAutoDeepen} deepenCount=${autoDeepenCount})`
                );
              });
            } else {
              safeNoteWrite("thinkmode.skip", () => {
                notesStore.recordScan(
                  `Think mode skipped: pro model unhealthy or non-overridable. Keeping '${requested}'. (mode=${thinkMode} stuck=${shouldAutoDeepen})`
                );
              });
            }
          }

          if (requested) {
            const profileMap = state.subagentProfileOverrides;
            const overrideProfile =
              (isRecord(profileMap[requested]) ? profileMap[requested] : null) ??
              (isRecord(profileMap[rawRequested]) ? profileMap[rawRequested] : null);

            if (overrideProfile) {
              const overrideModel =
                typeof overrideProfile.model === "string" ? overrideProfile.model.trim() : "";
              const overrideVariant =
                typeof overrideProfile.variant === "string" ? overrideProfile.variant.trim() : "";
              if (overrideModel) {
                preferredModel = overrideModel;
              }
              if (overrideVariant) {
                preferredVariant = overrideVariant;
              }
              if (overrideModel || overrideVariant) {
                safeNoteWrite("subagent.profile.override", () => {
                  notesStore.recordScan(
                    `Subagent profile override applied: subagent=${requested}, model=${overrideModel || "(unchanged)"}, variant=${overrideVariant || "(unchanged)"}`
                  );
                });
              }
            }

            if (userPreferredModel) {
              preferredModel = userPreferredModel;
            }
            if (userPreferredVariant) {
              preferredVariant = userPreferredVariant;
            }

            const resolvedProfile = resolveAgentExecutionProfile(rawRequested || requested, {
              preferredModel,
              preferredVariant,
            });
            args.subagent_type = resolvedProfile.baseAgent;
            args.model = resolvedProfile.model;
            if (resolvedProfile.variant) {
              args.variant = resolvedProfile.variant;
            } else if ("variant" in args) {
              delete args.variant;
            }
            store.setLastTaskCategory(input.sessionID, resolvedProfile.baseAgent);
            store.setLastDispatch(
              input.sessionID,
              decision.primary,
              resolvedProfile.baseAgent,
              resolvedProfile.model,
              resolvedProfile.variant
            );

            if (thinkProfileApplied) {
              safeNoteWrite("thinkmode.resolved", () => {
                notesStore.recordScan(
                  `Think mode resolved profile: subagent=${resolvedProfile.baseAgent}, model=${resolvedProfile.model}, variant=${resolvedProfile.variant}`
                );
              });
            }
          }

          const finalSubagent =
            typeof args.subagent_type === "string" ? baseAgentName(args.subagent_type.trim()) : "";
          const verificationRoutes = new Set(["ctf-verify", "ctf-decoy-check"]);
          const envParityRequiredTargets = new Set<TargetType>(["PWN", "REV"]);
          if (
            state.mode === "CTF" &&
            verificationRoutes.has(finalSubagent)
          ) {
            if (state.phase !== "VERIFY") {
              throw new AegisPolicyDenyError(
                "Verification route is blocked until candidate review reaches VERIFY phase. Move through SCAN -> PLAN -> EXECUTE -> VERIFY first."
              );
            }
            if (!state.candidatePendingVerification || state.latestCandidate.trim().length === 0) {
              throw new AegisPolicyDenyError(
                "Verification route is blocked because no active candidate is pending verification."
              );
            }
            if (envParityRequiredTargets.has(state.targetType)) {
              if (!state.envParityChecked) {
                throw new AegisPolicyDenyError(
                  "PWN/REV verification route is blocked until env parity baseline is checked. Run `ctf_env_parity` first."
                );
              }
              if (!state.envParityAllMatch) {
                throw new AegisPolicyDenyError(
                  "PWN/REV verification route is blocked because env parity mismatch was detected. Re-align environment before verification."
                );
              }
            }
          }
          if (
            state.mode === "CTF" &&
            finalSubagent === "ctf-verify" &&
            state.latestCandidate.trim().length > 0 &&
            isLowConfidenceCandidate(state.latestCandidate)
          ) {
            throw new AegisPolicyDenyError(
              "Direct ctf-verify is blocked for low-confidence or decoy-like candidate. Run ctf-decoy-check and gather stronger evidence first."
            );
          }

          if (thinkMode !== "none") {
            store.setThinkMode(input.sessionID, "none");
          }

          if (config.skill_autoload.enabled) {
            const subagentType = typeof args.subagent_type === "string" ? args.subagent_type : decision.primary;
            const autoload = resolveAutoloadSkills({
              state,
              config,
              subagentType,
              availableSkills,
            });
            const merged = mergeLoadSkills({
              existing: args.load_skills,
              autoload,
              maxSkills: config.skill_autoload.max_skills,
              availableSkills,
            });
            if (merged.length > 0) {
              args.load_skills = merged;
            }
          }

          output.args = args;
          return;
        }

        if (input.tool !== "bash") {
          return;
        }

        const state = store.get(input.sessionID);
        const command = extractBashCommand(output.args);

        if (config.recovery.enabled && config.recovery.non_interactive_env) {
          const interactive = detectInteractiveCommand(command);
          if (interactive) {
            safeNoteWrite("non-interactive-env", () => {
              notesStore.recordScan(`Non-interactive guard blocked: id=${interactive.id} command=${command.slice(0, 120)}`);
            });
            throw new AegisPolicyDenyError(`[oh-my-Aegis non-interactive-env] ${interactive.reason}. Rewrite the command to be non-interactive.`);
          }
        }

        const claudeRules = getClaudeDenyRules();
        if (claudeRules.denyBash.length > 0) {
          const denied = claudeRules.denyBash.find((rule) => rule.re.test(sanitizeCommand(command)));
          if (denied) {
            throw new AegisPolicyDenyError(`Claude settings denied Bash: ${denied.raw}`);
          }
        }

        const scopePolicy = state.mode === "BOUNTY" ? getBountyScopePolicy() : null;
        const decision = evaluateBashCommand(command, config, state.mode, {
          scopeConfirmed: state.scopeConfirmed,
          scopePolicy,
          now: new Date(),
        });
        if (!decision.allow) {
          const denyLevel = decision.denyLevel ?? "hard";
          if (denyLevel === "soft") {
            pruneSoftBashOverrides();
            const override = softBashOverrideByCallId.get(input.callID);
            if (override) {
              softBashOverrideByCallId.delete(input.callID);
              safeNoteWrite("bash.override", () => {
                notesStore.recordScan(
                  `policy-override bash: reason=${override.reason || "(none)"} command=${override.command || "(empty)"}`
                );
              });
              return;
            }
          }
          throw new AegisPolicyDenyError(decision.reason ?? "Command blocked by Aegis policy.");
        }
      } catch (error) {
        if (error instanceof AegisPolicyDenyError) {
          throw error;
        }
        noteHookError("tool.execute.before", error);
      } finally {
        maybeRecordHookLatency("tool.execute.before", input, hookStartedAt);
      }
    },

    "permission.ask": async (input, output) => {
      try {
        const state = store.get(input.sessionID);
        if (input.type.toLowerCase() !== "bash") {
          return;
        }

        const command = extractBashCommand(input.metadata);
        const scopePolicy = state.mode === "BOUNTY" ? getBountyScopePolicy() : null;
        const decision = evaluateBashCommand(command, config, state.mode, {
          scopeConfirmed: state.scopeConfirmed,
          scopePolicy,
          now: new Date(),
        });
        output.status = "ask";
        if (!decision.allow) {
          pruneSoftBashOverrides();
          const denyLevel = decision.denyLevel ?? "hard";
          if (denyLevel === "soft") {
            if (input.callID) {
              softBashOverrideByCallId.set(input.callID, {
                addedAt: Date.now(),
                reason: decision.reason ?? "",
                command: decision.sanitizedCommand ?? command,
              });
              output.status = "ask";
            } else {
              output.status = "deny";
            }
          } else {
            output.status = "deny";
          }
        }
      } catch (error) {
        noteHookError("permission.ask", error);
      }
    },

    "tool.execute.after": async (input, output) => {
      const hookStartedAt = process.hrtime.bigint();
      try {
        await runClaudeCompatHookBestEffort("PostToolUse", {
          session_id: input.sessionID,
          call_id: input.callID,
          tool_name: input.tool,
          tool_title: output.title,
        });

        const originalTitle = output.title;
        const originalOutput = output.output;
        const raw = `${originalTitle}\n${originalOutput}`;
        const metricSignals: string[] = [];
        const metricExtras: Record<string, unknown> = {};

        // 도구 호출 카운터 업데이트
        {
          const isAegisTool =
            input.tool.startsWith("ctf_") || input.tool.startsWith("aegis_");
          const curState = store.get(input.sessionID);
          const history = [...curState.toolCallHistory, input.tool].slice(-20);
          store.update(input.sessionID, {
            toolCallCount: curState.toolCallCount + 1,
            aegisToolCallCount: curState.aegisToolCallCount + (isAegisTool ? 1 : 0),
            lastToolCallAt: Date.now(),
            toolCallHistory: history,
          });
        }

        if (input.tool === "task") {
          const stateForPlan = store.get(input.sessionID);
          const lastBase = baseAgentName(stateForPlan.lastTaskCategory || "");
          if (lastBase === "aegis-plan" && typeof originalOutput === "string" && originalOutput.trim().length > 0) {
            safeNoteWrite("plan.snapshot", () => {
              const root = notesStore.getRootDirectory();
              const planPath = join(root, "PLAN.md");
              const content = [
                "# PLAN",
                `updated_at: ${new Date().toISOString()}`,
                `session_id: ${input.sessionID}`,
                "",
                originalOutput.trimEnd(),
                "",
              ].join("\n");
              writeFileSync(planPath, content, "utf-8");
              notesStore.recordScan(`Plan snapshot updated: ${relative(ctx.directory, planPath)}`);
            });
          }
        }

        // Phase 자동 전환 heuristic
        if (config.auto_phase.enabled) {
          const apState = store.get(input.sessionID);
          if (
            apState.phase === "SCAN" &&
            apState.toolCallCount >= config.auto_phase.scan_to_plan_tool_count
          ) {
            store.applyEvent(input.sessionID, "scan_completed");
            metricSignals.push("auto_phase:scan_to_plan");
          } else if (
            apState.phase === "PLAN" &&
            config.auto_phase.plan_to_execute_on_todo &&
            input.tool === "todowrite"
          ) {
            store.applyEvent(input.sessionID, "plan_completed");
            metricSignals.push("auto_phase:plan_to_execute");
          }
        }

        if (config.enable_injection_logging && notesReady) {
          const indicators = detectInjectionIndicators(raw);
          if (indicators.length > 0) {
            safeNoteWrite("tool.execute.after.injection", () => {
              notesStore.recordInjectionAttempt(`tool.${input.tool}`, indicators, raw);
            });
            notesStore.flushNow();
          }
        }

        if (isContextLengthFailure(raw)) {
          store.applyEvent(input.sessionID, "context_length_exceeded");
          metricSignals.push("context_length_exceeded");
          maybeAutoCompactNotes(input.sessionID, "context_length_exceeded");
          await maybeShowToast({
            sessionID: input.sessionID,
            key: "context_length_exceeded",
            title: "oh-my-Aegis: context overflow",
            message: "Context length failure detected. Auto-compaction attempted.",
            variant: "warning",
          });

          await contextWindowRecoveryManager.handleContextFailureText(input.sessionID, raw);
        }

        if (isLikelyTimeout(raw)) {
          store.applyEvent(input.sessionID, "timeout");
          metricSignals.push("timeout");
        }

        const stateBeforeVerifyCheck = store.get(input.sessionID);
        const lastTaskBase = baseAgentName(
          stateBeforeVerifyCheck.lastTaskCategory || stateBeforeVerifyCheck.lastTaskRoute || ""
        );
        const contradictionArtifactRoutes = new Set([
          "ctf-web",
          "ctf-web3",
          "ctf-pwn",
          "ctf-rev",
          "ctf-crypto",
          "ctf-forensics",
          "ctf-explore",
          "ctf-research",
          "bounty-triage",
          "bounty-research",
        ]);
        const artifactHints = extractArtifactPathHints(raw);
        if (
          input.tool === "task" &&
          stateBeforeVerifyCheck.contradictionArtifactLockActive &&
          !stateBeforeVerifyCheck.contradictionPatchDumpDone &&
          contradictionArtifactRoutes.has(lastTaskBase) &&
          artifactHints.length > 0
        ) {
          store.recordContradictionArtifacts(input.sessionID, artifactHints);
          metricSignals.push("contradiction_artifacts_recorded");
          metricExtras.contradictionArtifactsRecorded = artifactHints;
          safeNoteWrite("contradiction.artifact", () => {
            notesStore.recordScan(
              `Contradiction artifact lock released: recorded artifact paths ${artifactHints.join(", ")}`
            );
          });
        }
        const routeVerifier =
          input.tool === "task" && (lastTaskBase === "ctf-verify" || lastTaskBase === "ctf-decoy-check");

        const verificationRelevant =
          routeVerifier ||
          isVerificationSourceRelevant(
            input.tool,
            output.title,
            {
              verifierToolNames: config.verification.verifier_tool_names,
              verifierTitleMarkers: config.verification.verifier_title_markers,
            }
          );

        if (stateBeforeVerifyCheck.targetType === "REV") {
          const revRisk = assessRevVmRisk(raw);
          if (revRisk.signals.length > 0) {
            store.setRevRisk(input.sessionID, revRisk);
          }

          const replayCheck = isReplayUnsafe(raw);
          if (replayCheck.unsafe) {
            const currentLowTrust = stateBeforeVerifyCheck.replayLowTrustBinaries || [];
            const newSignals = replayCheck.signals.filter((s) => !currentLowTrust.includes(s));
            if (newSignals.length > 0) {
              store.update(input.sessionID, {
                replayLowTrustBinaries: [...currentLowTrust, ...newSignals],
                revStaticTrust: Math.max(0, stateBeforeVerifyCheck.revStaticTrust - 0.3),
              });
            }
          }
        }

        {
          const domainRisk = assessDomainRisk(stateBeforeVerifyCheck.targetType, raw);
          if (domainRisk && domainRisk.signals.length > 0) {
            const existingSignals = stateBeforeVerifyCheck.revRiskSignals || [];
            const newDomainSignals = domainRisk.signals.filter((s) => !existingSignals.includes(s));
            if (newDomainSignals.length > 0) {
              store.update(input.sessionID, {
                revRiskSignals: [...existingSignals, ...newDomainSignals],
                revRiskScore: Math.min(1, stateBeforeVerifyCheck.revRiskScore + domainRisk.score),
              });
            }
          }
        }

        // 2-1: 모든 도구 출력에서 사전 flag 스캔 + 디코이 검사
        if (config.flag_detector.enabled && raw.length < 200_000) {
          const earlyCandidates = scanForFlags(raw, `tool.${input.tool}`);
          if (earlyCandidates.length > 0) {
            const stateForDecoy = store.get(input.sessionID);
            if (!stateForDecoy.decoySuspect) {
              const earlyDecoyResult = checkForDecoy(earlyCandidates, false);
              if (earlyDecoyResult.isDecoySuspect) {
                store.update(input.sessionID, {
                  decoySuspect: true,
                  decoySuspectReason: earlyDecoyResult.reason,
                });
                store.applyEvent(input.sessionID, "decoy_suspect");
                metricSignals.push("early_decoy_suspect");
                await maybeShowToast({
                  sessionID: input.sessionID,
                  key: "decoy_early",
                  title: "oh-my-Aegis: decoy suspect",
                  message: `Early decoy detection: ${earlyDecoyResult.reason}`,
                  variant: "warning",
                });
              }
            }
            const stateAfterDecoyCheck = store.get(input.sessionID);
            if (
              earlyCandidates.length > 0 &&
              !stateAfterDecoyCheck.candidatePendingVerification &&
              !stateAfterDecoyCheck.decoySuspect
            ) {
              store.applyEvent(input.sessionID, "candidate_found");
              store.setCandidate(input.sessionID, earlyCandidates[0].flag);
              metricSignals.push("early_candidate_found");
            }
          }
        }

        // 2-2: Stuck 감지 — Aegis 도구 미사용 + 연속 N회 비Aegis 도구 호출
        {
          const stuckState = store.get(input.sessionID);
          if (
            stuckState.toolCallCount > 0 &&
            stuckState.toolCallCount % 15 === 0 &&
            stuckState.aegisToolCallCount === 0 &&
            stuckState.phase !== "SCAN"
          ) {
            store.applyEvent(input.sessionID, "no_new_evidence");
            metricSignals.push("stuck:no_aegis_tool_usage");
          }

          // 동일 도구 패턴 감지 (최근 5개가 모두 같은 도구명)
          const last5 = stuckState.toolCallHistory.slice(-5);
          if (last5.length === 5 && new Set(last5).size === 1 && last5[0] !== stuckState.lastToolPattern) {
            store.update(input.sessionID, {
              staleToolPatternLoops: stuckState.staleToolPatternLoops + 1,
              lastToolPattern: last5[0],
            });
            metricSignals.push(`stuck:stale_pattern:${last5[0]}`);
          }
        }

        if (verificationRelevant) {
          if (isVerifyFailure(raw)) {
            const contradictionEvidence = extractVerifierEvidence(raw, stateBeforeVerifyCheck.latestCandidate);
            const contradictionDetected = stateBeforeVerifyCheck.mode === "CTF" && Boolean(contradictionEvidence);
            if (stateBeforeVerifyCheck.mode === "CTF" && contradictionEvidence) {
              const summary = raw.replace(/\s+/g, " ").trim().slice(0, 240);
              const failedRoute = stateBeforeVerifyCheck.lastTaskCategory || route(stateBeforeVerifyCheck, config).primary;
              store.recordFailure(input.sessionID, "static_dynamic_contradiction", failedRoute, summary);
            }
            store.applyEvent(input.sessionID, "verify_fail");
            metricSignals.push("verify_fail");
            appendLedgerFromRuntime(
              input.sessionID,
              "verify_fail",
              contradictionDetected ? "dynamic_memory" : "behavioral_runtime",
              contradictionDetected ? 0.9 : 0.7,
              raw,
              "tool.execute.after"
            );
            if (contradictionDetected) {
              store.applyEvent(input.sessionID, "static_dynamic_contradiction");
              metricSignals.push("static_dynamic_contradiction");

              const stForSLA = store.get(input.sessionID);
              const slaLoops = stForSLA.contradictionSLALoops + 1;
              store.update(input.sessionID, {
                contradictionSLALoops: slaLoops,
                contradictionSLADumpRequired: slaLoops >= 1 && !stForSLA.contradictionPatchDumpDone,
              });
            }

            {
              const stForDecoy = store.get(input.sessionID);
              const flagCandidates = scanForFlags(raw, "verify_fail");
              const existingCandidates = stForDecoy.latestCandidate
                ? [{ flag: stForDecoy.latestCandidate, format: "", source: "candidate", confidence: "medium" as const, timestamp: Date.now() }]
                : [];
              const allCandidates = [...flagCandidates, ...existingCandidates];
              const decoyCheck = checkForDecoy(allCandidates, false);
              if (decoyCheck.isDecoySuspect && !stForDecoy.decoySuspect) {
                store.update(input.sessionID, {
                  decoySuspect: true,
                  decoySuspectReason: decoyCheck.reason,
                });
                store.applyEvent(input.sessionID, "decoy_suspect");
                metricSignals.push("decoy_suspect");
              }
            }

            await maybeShowToast({
              sessionID: input.sessionID,
              key: "verify_fail",
              title: "oh-my-Aegis: verify fail",
              message: "Verifier reported failure.",
              variant: "error",
            });
          } else if (isVerifySuccess(raw)) {
            const verifierEvidence = extractVerifierEvidence(raw, stateBeforeVerifyCheck.latestCandidate);
            const isCTF = stateBeforeVerifyCheck.mode === "CTF";
            const tt = stateBeforeVerifyCheck.targetType;
            const strictBinaryVerifyTarget = isCTF && (tt === "PWN" || tt === "REV");
            const oracleOk = hasVerifyOracleSuccess(raw);
            const exitCodeOk = hasExitCodeZeroEvidence(raw);
            const runtimeEvidenceOk = hasRuntimeEvidence(raw);
            const parityEvidenceOk =
              stateBeforeVerifyCheck.envParityChecked && stateBeforeVerifyCheck.envParityAllMatch;
            const envEvidenceOk = parityEvidenceOk || runtimeEvidenceOk;

            const httpEvidenceOk = /\b(?:HTTP\/[12]|status[:\s]*[2345]\d\d|response\s*body)/i.test(raw);
            const txEvidenceOk = /\b(?:0x[0-9a-f]{64}|transaction\s*hash|tx\s*hash|simulation\s*pass)/i.test(raw);
            const testVectorOk = /\b(?:test\s*vector|known\s*plaintext|decrypt(?:ed|ion)\s*match)/i.test(raw);
            const artifactHashOk = /\b(?:sha256|md5|hash[:\s]+[0-9a-f]{32,64}|artifact\s*(?:hash|digest))/i.test(raw);

            let domainGatePassed = true;
            if (isCTF) {
              if (tt === "PWN" || tt === "REV") {
                domainGatePassed = oracleOk && exitCodeOk && envEvidenceOk;
              } else if (tt === "WEB_API") {
                domainGatePassed = oracleOk && httpEvidenceOk;
              } else if (tt === "WEB3") {
                domainGatePassed = oracleOk && txEvidenceOk;
              } else if (tt === "CRYPTO") {
                domainGatePassed = oracleOk && testVectorOk;
              } else if (tt === "FORENSICS") {
                domainGatePassed = oracleOk && artifactHashOk;
              } else {
                domainGatePassed = oracleOk;
              }
            }

            const strictGatePassed = domainGatePassed;

            if (hasVerifierEvidence(raw, stateBeforeVerifyCheck.latestCandidate) && verifierEvidence && strictGatePassed) {
              const acceptanceOk = hasAcceptanceEvidence(raw);
              const normalizedSummary = raw.replace(/\s+/g, " ").trim().slice(0, 240);

              store.setCandidate(input.sessionID, verifierEvidence);
              store.applyEvent(input.sessionID, "verify_success");
              metricSignals.push("verify_success");
              metricExtras.verifiedEvidence = verifierEvidence;

              appendLedgerFromRuntime(
                input.sessionID,
                "verify_success",
                acceptanceOk ? "acceptance_oracle" : "behavioral_runtime",
                acceptanceOk ? 1 : 0.85,
                normalizedSummary,
                "tool.execute.after"
              );

              if (acceptanceOk) {
                store.setVerified(input.sessionID, verifierEvidence);
                store.setAcceptanceEvidence(input.sessionID, normalizedSummary);
                store.applyEvent(input.sessionID, "submit_accepted");
                metricSignals.push("submit_accepted");
                await maybeShowToast({
                  sessionID: input.sessionID,
                  key: "verify_success",
                  title: "oh-my-Aegis: verified",
                  message: "Verifier success and acceptance evidence confirmed.",
                  variant: "success",
                });
              } else {
                metricSignals.push("submit_pending");
                await maybeShowToast({
                  sessionID: input.sessionID,
                  key: "submit_pending",
                  title: "oh-my-Aegis: submit gate pending",
                  message: "Verification passed, but acceptance oracle evidence is still required before final submit.",
                  variant: "warning",
                });
              }
            } else {
              const summary = raw.replace(/\s+/g, " ").trim().slice(0, 240);
              const isContradiction = isCTF && !domainGatePassed && hasVerifierEvidence(raw, stateBeforeVerifyCheck.latestCandidate);
              const failureReason = isContradiction ? "static_dynamic_contradiction" : "verification_mismatch";
              metricSignals.push("verify_blocked");
              metricExtras.verifyBlockedReason = failureReason;
              store.setFailureDetails(
                input.sessionID,
                failureReason,
                stateBeforeVerifyCheck.lastTaskCategory || route(stateBeforeVerifyCheck, config).primary,
                summary
              );
              store.applyEvent(input.sessionID, "verify_fail");
              appendLedgerFromRuntime(
                input.sessionID,
                "verify_fail",
                isContradiction ? "dynamic_memory" : "behavioral_runtime",
                isContradiction ? 0.9 : 0.65,
                summary,
                "tool.execute.after"
              );
              if (isContradiction) {
                store.applyEvent(input.sessionID, "static_dynamic_contradiction");
                metricSignals.push("static_dynamic_contradiction");
                if (!envEvidenceOk) {
                  store.applyEvent(input.sessionID, "readonly_inconclusive");
                  metricSignals.push("readonly_inconclusive");
                }
              }
              await maybeShowToast({
                sessionID: input.sessionID,
                key: "verify_fail_no_evidence",
                title: "oh-my-Aegis: verify blocked",
                message: !domainGatePassed
                  ? `Success marker blocked by ${tt} domain verify gate (domain-specific evidence required).`
                  : "Success marker detected but verifier evidence was missing.",
                variant: "warning",
              });
            }
          }
        }

        const classifiedFailure = classifyFailureReason(raw);
        if (classifiedFailure === "hypothesis_stall") {
          const stateForFailure = store.get(input.sessionID);
          const failedRoute = stateForFailure.lastTaskCategory || route(stateForFailure, config).primary;
          const summary = raw.replace(/\s+/g, " ").trim().slice(0, 240);
          store.setFailureDetails(input.sessionID, classifiedFailure, failedRoute, summary);
          if (/(same payload|same_payload)/i.test(raw)) {
            store.applyEvent(input.sessionID, "same_payload_repeat");
            metricSignals.push("same_payload_repeat");
          } else {
            store.applyEvent(input.sessionID, "no_new_evidence");
            metricSignals.push("no_new_evidence");
          }
        } else if (
          classifiedFailure === "exploit_chain" ||
          classifiedFailure === "environment" ||
          classifiedFailure === "unsat_claim" ||
          classifiedFailure === "static_dynamic_contradiction"
        ) {
          const stateForFailure = store.get(input.sessionID);
          const failedRoute = stateForFailure.lastTaskCategory || route(stateForFailure, config).primary;
          const summary = raw.replace(/\s+/g, " ").trim().slice(0, 240);
          store.recordFailure(input.sessionID, classifiedFailure, failedRoute, summary);
          metricSignals.push(`failure:${classifiedFailure}`);
        }

        if (input.tool === "task") {
          const state = store.get(input.sessionID);
          const isRetryableFailure = isRetryableTaskFailure(raw);
          const tokenOrQuotaFailure = isTokenOrQuotaFailure(raw);
          const useModelFailover =
            tokenOrQuotaFailure &&
            config.dynamic_model.enabled &&
            config.dynamic_model.generate_variants;
          const isHardFailure =
            !isRetryableFailure &&
            (classifiedFailure === "verification_mismatch" ||
              classifiedFailure === "hypothesis_stall" ||
              classifiedFailure === "unsat_claim" ||
              classifiedFailure === "static_dynamic_contradiction" ||
              classifiedFailure === "exploit_chain" ||
              classifiedFailure === "environment");

          if (isRetryableFailure) {
            store.recordDispatchOutcome(input.sessionID, "retryable_failure");
          } else if (isHardFailure) {
            store.recordDispatchOutcome(input.sessionID, "hard_failure");
          } else {
            store.recordDispatchOutcome(input.sessionID, "success");
          }


          if (tokenOrQuotaFailure) {
            const lastSubagent = state.lastTaskSubagent;
            const model =
              state.lastTaskModel.trim().length > 0
                ? state.lastTaskModel.trim()
                : lastSubagent
                  ? agentModel(lastSubagent)
                  : undefined;
            if (model) {
              store.markModelUnhealthy(input.sessionID, model, "rate_limit_or_quota");
              safeNoteWrite("model.unhealthy", () => {
                notesStore.recordScan(
                  `Model marked unhealthy: ${model} (via ${lastSubagent}). Dynamic failover will route to alternative model.`
                );
              });
            }
          }

          if (
            isRetryableFailure &&
            !useModelFailover &&
            state.taskFailoverCount < config.auto_dispatch.max_failover_retries
          ) {
            store.triggerTaskFailover(input.sessionID);
            await maybeShowToast({
              sessionID: input.sessionID,
              key: "task_failover_armed",
              title: "oh-my-Aegis: failover armed",
              message: `Next task will use fallback agent (attempt ${state.taskFailoverCount + 1}/${config.auto_dispatch.max_failover_retries}).`,
              variant: "warning",
            });
            safeNoteWrite("task.failover", () => {
              notesStore.recordScan(
                `Auto failover armed: next task call will use fallback subagent (attempt ${state.taskFailoverCount + 1}/${config.auto_dispatch.max_failover_retries}).`
              );
            });
          } else if (!isRetryableFailure && (state.pendingTaskFailover || state.taskFailoverCount > 0)) {
            store.clearTaskFailover(input.sessionID);
          }
        }

        const metricState = store.get(input.sessionID);
        if (metricSignals.length > 0) {
          appendOrchestrationMetric({
            at: new Date().toISOString(),
            source: "tool.execute.after",
            sessionID: input.sessionID,
            callID: input.callID,
            tool: input.tool,
            title: output.title,
            signals: [...new Set(metricSignals)],
            mode: metricState.mode,
            phase: metricState.phase,
            targetType: metricState.targetType,
            route: metricState.lastTaskRoute || metricState.lastTaskCategory,
            subagent: metricState.lastTaskSubagent,
            model: metricState.lastTaskModel,
            variant: metricState.lastTaskVariant,
            candidate: metricState.latestCandidate,
            verified: metricState.latestVerified,
            failureReason: metricState.lastFailureReason,
            failedRoute: metricState.lastFailedRoute,
            failureSummary: metricState.lastFailureSummary,
            contradictionPivotDebt: metricState.contradictionPivotDebt,
            contradictionPatchDumpDone: metricState.contradictionPatchDumpDone,
            contradictionArtifactLockActive: metricState.contradictionArtifactLockActive,
            contradictionArtifacts: metricState.contradictionArtifacts,
            envParityChecked: metricState.envParityChecked,
            envParityAllMatch: metricState.envParityAllMatch,
            envParityRequired: metricState.envParityRequired,
            envParityRequirementReason: metricState.envParityRequirementReason,
            verifyFailCount: metricState.verifyFailCount,
            noNewEvidenceLoops: metricState.noNewEvidenceLoops,
            samePayloadLoops: metricState.samePayloadLoops,
            timeoutFailCount: metricState.timeoutFailCount,
            contextFailCount: metricState.contextFailCount,
            taskFailoverCount: metricState.taskFailoverCount,
            ...metricExtras,
          });
        }

        if (input.tool === "read") {
          const entry = readContextByCallId.get(input.callID);
          if (entry) {
            readContextByCallId.delete(input.callID);
            if (config.context_injection.enabled) {
              const rawPath = entry.filePath;
              const resolvedTarget = isAbsolute(rawPath) ? resolve(rawPath) : resolve(ctx.directory, rawPath);
              const lowered = resolvedTarget.toLowerCase();
              const isContextFile = lowered.endsWith("/agents.md") || lowered.endsWith("\\agents.md") || lowered.endsWith("/readme.md") || lowered.endsWith("\\readme.md");
              if (!isContextFile && isPathInsideRoot(resolvedTarget, ctx.directory)) {
                let baseDir = resolvedTarget;
                try {
                  const st = statSync(resolvedTarget);
                  if (st.isFile()) {
                    baseDir = dirname(resolvedTarget);
                  }
                } catch {
                  baseDir = dirname(resolvedTarget);
                }

                const injectedSet = injectedContextPathsFor(input.sessionID);
                const maxFiles = config.context_injection.max_files;
                const maxPer = config.context_injection.max_chars_per_file;
                const maxTotal = config.context_injection.max_total_chars;

                const toInject: string[] = [];
                let current = baseDir;
                for (let depth = 0; depth < 30; depth += 1) {
                  if (!isPathInsideRoot(current, ctx.directory)) {
                    break;
                  }
                  if (config.context_injection.inject_agents_md) {
                    const agents = join(current, "AGENTS.md");
                    if (existsSync(agents) && !injectedSet.has(agents) && toInject.length < maxFiles) {
                      injectedSet.add(agents);
                      toInject.push(agents);
                    }
                  }
                  if (config.context_injection.inject_readme_md) {
                    const readme = join(current, "README.md");
                    if (existsSync(readme) && !injectedSet.has(readme) && toInject.length < maxFiles) {
                      injectedSet.add(readme);
                      toInject.push(readme);
                    }
                  }
                  if (toInject.length >= maxFiles) {
                    break;
                  }
                  if (resolve(current) === resolve(ctx.directory)) {
                    break;
                  }
                  const parent = dirname(current);
                  if (parent === current) {
                    break;
                  }
                  current = parent;
                }

                if (toInject.length > 0) {
                  const relTarget = relative(ctx.directory, resolvedTarget);
                  const lines: string[] = [];
                  const pushLine = (value: string): void => {
                    lines.push(value);
                  };
                  pushLine("[oh-my-Aegis context-injector]");
                  pushLine(`read_target: ${relTarget}`);
                  pushLine("files:");
                  for (const p of toInject) {
                    pushLine(`- ${relative(ctx.directory, p)}`);
                  }
                  pushLine("");

                  let totalChars = lines.reduce((sum, item) => sum + item.length + 1, 0);
                  for (const p of toInject) {
                    let content = "";
                    try {
                      content = readFileSync(p, "utf-8");
                    } catch {
                      continue;
                    }
                    if (content.length > maxPer) {
                      content = `${content.slice(0, maxPer)}\n...[truncated]`;
                    }
                    const rel = relative(ctx.directory, p);
                    const block = [`--- BEGIN ${rel} ---`, content.trimEnd(), `--- END ${rel} ---`, ""].join("\n");
                    if (totalChars + block.length + 1 > maxTotal) {
                      break;
                    }
                    totalChars += block.length + 1;
                    pushLine(block);
                  }

                  const injectedText = lines.join("\n").trimEnd();
                  if (injectedText.length > 0) {
                    output.output = `${injectedText}\n\n${output.output}`;
                  }
                }
              }
            }

            if (config.rules_injector.enabled) {
              const rawPath = entry.filePath;
              const resolvedTarget = isAbsolute(rawPath) ? resolve(rawPath) : resolve(ctx.directory, rawPath);
              if (isPathInsideRoot(resolvedTarget, ctx.directory)) {
                const relTarget = normalizePathForMatch(relative(ctx.directory, resolvedTarget));
                const rules = getClaudeRules();
                const injectedSet = injectedClaudeRulePathsFor(input.sessionID);
                const maxFiles = config.rules_injector.max_files;
                const maxPer = config.rules_injector.max_chars_per_file;
                const maxTotal = config.rules_injector.max_total_chars;

                const matched = rules.rules.filter((rule) => {
                  if (!rule.body) return false;
                  if (injectedSet.has(rule.sourcePath)) return false;
                  if (rule.pathRes.length === 0) return true;
                  return rule.pathRes.some((re) => re.test(relTarget));
                });

                if (matched.length > 0) {
                  const picked: ClaudeRuleEntry[] = [];
                  for (const rule of matched) {
                    if (picked.length >= maxFiles) break;
                    injectedSet.add(rule.sourcePath);
                    picked.push(rule);
                  }

                  const lines: string[] = [];
                  const pushLine = (value: string): void => {
                    lines.push(value);
                  };
                  pushLine("[oh-my-Aegis rules-injector]");
                  pushLine(`read_target: ${relTarget}`);
                  pushLine("rules:");
                  for (const r of picked) {
                    pushLine(`- ${r.relPath}${r.pathGlobs.length > 0 ? ` (paths=${r.pathGlobs.join(",")})` : ""}`);
                  }
                  pushLine("");

                  let totalChars = lines.reduce((sum, item) => sum + item.length + 1, 0);
                  for (const r of picked) {
                    let content = r.body;
                    if (content.length > maxPer) {
                      content = `${content.slice(0, maxPer)}\n...[truncated]`;
                    }
                    const block = [`--- BEGIN ${r.relPath} ---`, content.trimEnd(), `--- END ${r.relPath} ---`, ""].join(
                      "\n"
                    );
                    if (totalChars + block.length + 1 > maxTotal) {
                      break;
                    }
                    totalChars += block.length + 1;
                    pushLine(block);
                  }

                  const injectedText = lines.join("\n").trimEnd();
                  if (injectedText.length > 0) {
                    output.output = `${injectedText}\n\n${output.output}`;
                    safeNoteWrite("rules-injector", () => {
                      notesStore.recordScan(
                        `Rules injected: count=${picked.length} target=${relTarget}`
                      );
                    });
                  }
                }
              }
            }
          }
        }

        if (config.comment_checker.enabled) {
          const state = store.get(input.sessionID);
          const onlyInBounty = config.comment_checker.only_in_bounty;
          if (!onlyInBounty || state.mode === "BOUNTY") {
            const text = typeof originalOutput === "string" ? originalOutput : "";
            const looksLikePatch =
              text.includes("*** Begin Patch") ||
              text.includes("diff --git") ||
              /(^|\n)@@\s*[-+]?\d+/.test(text);
            if (looksLikePatch) {
              const addedLines: string[] = [];
              const lines = text.split(/\r?\n/);
              for (const line of lines) {
                if (!line.startsWith("+")) {
                  continue;
                }
                if (line.startsWith("+++")) {
                  continue;
                }
                const content = line.slice(1);
                if (!content.trim()) {
                  continue;
                }
                addedLines.push(content);
              }

              if (addedLines.length >= config.comment_checker.min_added_lines) {
                const isCommentLine = (value: string): boolean => {
                  const trimmed = value.trimStart();
                  if (!trimmed) return false;
                  return (
                    trimmed.startsWith("//") ||
                    trimmed.startsWith("#") ||
                    trimmed.startsWith("/*") ||
                    trimmed.startsWith("*") ||
                    trimmed.startsWith("<!--")
                  );
                };
                const commentLines = addedLines.filter(isCommentLine);
                const ratio = addedLines.length > 0 ? commentLines.length / addedLines.length : 0;

                const aiSlopMarkers = ["as an ai", "chatgpt", "claude", "llm", "generated by", "ai-generated"];
                const aiSlopDetected = commentLines.some((line) => {
                  const lowered = line.toLowerCase();
                  return aiSlopMarkers.some((marker) => lowered.includes(marker));
                });

                const triggered =
                  aiSlopDetected ||
                  ratio >= config.comment_checker.max_comment_ratio ||
                  commentLines.length >= config.comment_checker.max_comment_lines;
                if (triggered) {
                  const header = `[oh-my-Aegis comment-checker] added=${addedLines.length} comment=${commentLines.length} ratio=${ratio.toFixed(2)}${aiSlopDetected ? " ai_slop=detected" : ""}`;
                  const hint = "Hint: reduce non-essential comments (especially AI-style disclaimers).";
                  if (typeof output.output === "string" && !output.output.startsWith("[oh-my-Aegis comment-checker]")) {
                    output.output = `${header}\n${hint}\n\n${output.output}`;
                  }
                  safeNoteWrite("comment-checker", () => {
                    notesStore.recordScan(`${header} tool=${input.tool}`);
                  });
                }
              }
            }
          }
        }

        if (config.recovery.enabled && config.recovery.edit_error_hint) {
          const toolLower = String(input.tool || "").toLowerCase();
          if (toolLower === "edit" || toolLower === "write") {
            const lower = raw.toLowerCase();
            const hasPatchTerms = /(apply_patch|patch|hunk|anchor|offset|failed to apply)/i.test(lower);
            const hasFailureTerms = /(verification failed|failed|error|cannot|unable|not found|mismatch)/i.test(lower);
            if (hasPatchTerms && hasFailureTerms) {
              const hint = [
                "[oh-my-Aegis recovery]",
                "- Detected edit/patch application error.",
                "- Next: re-read the target file, shrink the patch hunk, and retry.",
              ].join("\n");
              if (typeof output.output === "string" && !output.output.startsWith("[oh-my-Aegis recovery]")) {
                output.output = `${hint}\n\n${output.output}`;
              }
              safeNoteWrite("recovery.edit", () => {
                notesStore.recordScan(`Edit recovery hint emitted: tool=${input.tool}`);
              });
            }
          }
        }

        if (config.tool_output_truncator.enabled) {
          const perTool = config.tool_output_truncator.per_tool_max_chars ?? {};
          const configured = perTool[input.tool];
          const max = typeof configured === "number" && Number.isFinite(configured)
            ? configured
            : config.tool_output_truncator.max_chars;
          if (typeof output.output === "string" && output.output.length > max) {
            const pre = output.output;
            const persistedOutput = config.tool_output_truncator.persist_mask_sensitive
              ? maskSensitiveToolOutput(pre)
              : pre;
            const savedPath = writeToolOutputArtifact({
              sessionID: input.sessionID,
              tool: input.tool,
              callID: input.callID,
              title: originalTitle,
              output: persistedOutput,
            });
            const headTarget = config.tool_output_truncator.head_chars;
            const tailTarget = config.tool_output_truncator.tail_chars;
            const safeHead = Math.max(0, Math.min(headTarget, max));
            const safeTail = Math.max(0, Math.min(tailTarget, Math.max(0, max - safeHead)));
            const truncated = truncateWithHeadTail(pre, safeHead, safeTail);
            const savedRel = savedPath && isPathInsideRoot(savedPath, ctx.directory) ? relative(ctx.directory, savedPath) : savedPath;
            output.output = [
              "[oh-my-Aegis tool-output-truncated]",
              `- tool=${input.tool} callID=${input.callID}`,
              savedRel ? `- saved=${savedRel}` : "- saved=(failed)",
              `- original_chars=${pre.length}`,
              "",
              truncated,
            ].join("\n");
          }
        }

        if (config.flag_detector?.enabled !== false) {
          const outputText = typeof output.output === "string" ? output.output : "";
          if (outputText.length > 0 && outputText.length < 100_000 && containsFlag(outputText)) {
            const flags = scanForFlags(outputText, `tool:${input.tool}`);
            if (flags.length > 0) {
              const alert = buildFlagAlert(flags);
              safeNoteWrite("flag-detector", () => {
                notesStore.recordScan(
                  `Flag candidate detected in ${input.tool} output: ${flags.map((f) => f.flag).join(", ")}\n${alert}`
                );
              });
            }
          }
        }
      } catch (error) {
        noteHookError("tool.execute.after", error);
      } finally {
        maybeRecordHookLatency("tool.execute.after", input, hookStartedAt);
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) {
        return;
      }
      const state = store.get(input.sessionID);
      const decision = route(state, config);

      const systemLines: string[] = [
        `MODE: ${state.mode}`,
        `PHASE: ${state.phase}`,
        `TARGET: ${state.targetType}`,
        `ULTRAWORK: ${state.ultraworkEnabled ? "ENABLED" : "DISABLED"}`,
        `NEXT_ROUTE: ${decision.primary} (${decision.reason})`,
        "",
        buildPhaseInstruction(state),
        "",
      ];

      const signalGuidance = buildSignalGuidance(state);
      if (signalGuidance.length > 0) {
        systemLines.push(...signalGuidance, "");
      }

      systemLines.push(buildToolGuide(state), "");

      const playbook = buildTaskPlaybook(state, config);
      if (playbook) {
        systemLines.push(playbook, "");
      }

      systemLines.push(
        `RULE: each loop must maintain plan + todo list (multiple todos allowed, one in_progress), then verify/log.`
      );
      if (state.ultraworkEnabled) {
        systemLines.push(`RULE: ultrawork enabled - do not stop without verified evidence.`);
      }

      output.system.push(systemLines.join("\n"));
    },

    "experimental.session.compacting": async (input, output) => {
      const state = store.get(input.sessionID);
      output.context.push(
        `orchestrator-state: mode=${state.mode}, phase=${state.phase}, target=${state.targetType}, verifyFailCount=${state.verifyFailCount}`
      );
      output.context.push(
        `markdown-budgets: WORKLOG ${config.markdown_budget.worklog_lines} lines/${config.markdown_budget.worklog_bytes} bytes; EVIDENCE ${config.markdown_budget.evidence_lines}/${config.markdown_budget.evidence_bytes}`
      );

      try {
        const root = notesStore.getRootDirectory();
        const contextPackPath = join(root, "CONTEXT_PACK.md");
        if (existsSync(contextPackPath)) {
          const text = readFileSync(contextPackPath, "utf-8").trim();
          if (text) {
            output.context.push(`durable-context:\n${text.slice(0, 16_000)}`);
          }
        }

        const planPath = join(root, "PLAN.md");
        if (existsSync(planPath)) {
          const text = readFileSync(planPath, "utf-8").trim();
          if (text) {
            output.context.push(`durable-plan:\n${text.slice(0, 12_000)}`);
          }
        }
      } catch (error) {
        noteHookError("session.compacting", error);
      }
    },

    "experimental.text.complete": async (input, output) => {
      try {
        if (config.recovery.enabled && config.recovery.thinking_block_validator) {
          const fixed = sanitizeThinkingBlocks(output.text);
          if (fixed !== null) {
            output.text = fixed;
            safeNoteWrite("thinking-block-validator", () => {
              notesStore.recordScan(
                `Thinking block validator applied: session=${input.sessionID} message=${input.messageID}`
              );
            });
          }
        }

        if (!config.recovery.enabled || !config.recovery.empty_message_sanitizer) {
          return;
        }
        if (output.text.trim().length > 0) {
          return;
        }
        output.text = "[oh-my-Aegis recovery] Empty message recovered. Please retry the last step.";
        safeNoteWrite("recovery.empty", () => {
          notesStore.recordScan(
            `Empty message sanitized: session=${input.sessionID} message=${input.messageID} part=${input.partID}`
          );
        });
      } catch (error) {
        noteHookError("text.complete", error);
      }
    },
  };
};

export default OhMyAegisPlugin;
