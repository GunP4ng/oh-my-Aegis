import type { Plugin } from "@opencode-ai/plugin";
const _packageJson = await import("../package.json");
const AEGIS_VERSION = typeof _packageJson.version === "string" ? _packageJson.version : "0.0.0";
import type { AgentConfig, McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "./config/loader";
import { buildReadinessReport } from "./config/readiness";
import { createBuiltinMcps } from "./mcp";
import { buildTaskPlaybook } from "./orchestration/playbook";
import { detectRevLoaderVm, shouldForceRelocPatchDump } from "./orchestration/auto-triage";
import { buildSignalGuidance, buildPhaseInstruction, buildDelegateBiasSection, buildHardBlocksSection, buildParallelRulesSection, buildProblemStateSection, buildRouteTransparencySection, buildAvailableSubagentsSection } from "./orchestration/signal-actions";
import { buildIntentGateSection } from "./orchestration/intent-gate";
import { buildToolGuide } from "./orchestration/tool-guide";
import {
  shapeTaskDispatch,
  shapeTaskPromptContext,
} from "./orchestration/task-dispatch";
import { buildWorkPackage, isStuck, route } from "./orchestration/router";
import {
  agentModel,
  baseAgentName,
  providerFamilyFromModel,
} from "./orchestration/model-health";
import { evaluateIndependentReviewGate } from "./orchestration/review-gate";
import { evaluateCouncilPolicy } from "./orchestration/council-policy";
import { SingleWriterApplyLock } from "./orchestration/apply-lock";
import {
  digestFromPatchDiffRef as digestFromPatchDiffRefShared,
  evaluateApplyGovernancePrerequisites as evaluateApplyGovernancePrerequisitesShared,
} from "./orchestration/apply-governance-helpers";
import { appendJsonlRecord, appendJsonlRecords } from "./orchestration/jsonl-sink";
import { tryAcquireInstanceLock } from "./io/instance-lock";
import { createRouteLogger } from "./orchestration/route-logging";
import { createAutoLoopRunner } from "./orchestration/auto-loop";
import { createStartupToastManager } from "./orchestration/startup-toast";
import { configureParallelPersistence, getActiveGroup } from "./orchestration/parallel";
import { loadScopePolicyFromWorkspace } from "./bounty/scope-policy";
import type { BountyScopePolicy, ScopeDocLoadResult } from "./bounty/scope-policy";
import { maybeNpmAutoUpdatePackage, resolveOpencodeCacheDir } from "./install/npm-auto-update";
import { evaluateBashCommand, extractBashCommand, isApplyTransitionAttempt } from "./risk/policy-matrix";
import {
  sanitizeCommand,
  classifyFailureReason,
  detectInjectionIndicators,
  detectInteractiveCommand,
  isContextLengthFailure,
  isLikelyTimeout,
  isVerificationSourceRelevant,
  extractVerifierEvidence,
  assessRevVmRisk,
  assessDomainRisk,
  sanitizeThinkingBlocks,
} from "./risk/sanitize";
import { appendEvidenceLedger, scoreEvidence, type EvidenceEntry, type EvidenceType } from "./orchestration/evidence-ledger";
import { parseOracleProgressFromText } from "./orchestration/parse-oracle-progress";
import { isReplayUnsafe } from "./orchestration/flag-detector";
import {
  buildEvidenceLedgerIntentsStage,
  buildPlanSnapshotStage,
  captureGovernanceArtifactsStage,
  classifyFailureForMetricsStage,
  classifyFlagDetectorStage,
  classifyTaskOutcomeAndModelHealthStage,
  classifyVerificationStage,
  classifyVerifyFailDecoyStage,
  contradictionArtifactStage,
  earlyFlagDecoyStage,
  evaluateOracleProgressStage,
  routeVerifierStage,
  shapeTaskFailoverAutoloopStage,
} from "./orchestration/posthook-stages";
import { NotesStore } from "./state/notes-store";
import { normalizeSessionID } from "./state/session-id";
import { SessionStore } from "./state/session-store";
import type { AegisTodoEntry } from "./state/types";
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
import { discoverAvailableSkills } from "./skills/autoload";
import { runClaudeHook } from "./hooks/claude-compat";
import { isRecord } from "./utils/is-record";
import { safeJsonParseObject } from "./utils/json";
import {
  detectDockerParityRequirement,
  AegisPolicyDenyError,
  normalizeToolName,
  maskSensitiveToolOutput,
  isPathInsideRoot,
  truncateWithHeadTail,
  extractArtifactPathHints,
  isAegisManagerAllowedTool,
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
import {
  applyLoopGuard as applyLoopGuardHelper,
  buildSharedChannelPrompt as buildSharedChannelPromptHelper,
  normalizeTodoEntries as normalizeTodoEntriesHelper,
  stableActionSignature as stableActionSignatureHelper,
} from "./helpers/index-core-wave9";

const OhMyAegisPlugin: Plugin = async (ctx) => {
  const configWarnings: string[] = [];
  const config = loadConfig(ctx.directory, { onWarning: (msg) => configWarnings.push(msg) });
  const availableSkills = discoverAvailableSkills(ctx.directory);
  const godModeEnabled = ["1", "true", "yes", "on"].includes((process.env.AEGIS_GOD_MODE ?? "").trim().toLowerCase());

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

  const latencyBuffer: Record<string, unknown>[] = [];
  let latencyFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushLatencyBuffer = (): void => {
    if (!notesReady || latencyBuffer.length === 0) {
      return;
    }
    try {
      const path = join(notesStore.getRootDirectory(), "latency.jsonl");
      const payload = [...latencyBuffer];
      latencyBuffer.length = 0;
      appendJsonlRecords(path, payload);
    } catch (error) {
      noteHookError("latency.flush", error);
    }
  };

  appendLatencySample = (sample: Record<string, unknown>): void => {
    if (!notesReady) {
      return;
    }
    try {
      latencyBuffer.push({ at: new Date().toISOString(), ...sample });
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
  const searchModeRequestedBySession = new Set<string>();
  const searchModeGuidancePendingBySession = new Set<string>();
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

  const digestFromPatchDiffRef = (
    patchDiffRef: string,
  ): { ok: true; digest: string } | { ok: false; reason: string } => {
    return digestFromPatchDiffRefShared(patchDiffRef, {
      resolvePatchDiffRef: (candidatePatchDiffRef) => {
        const absPath = isAbsolute(candidatePatchDiffRef) ? resolve(candidatePatchDiffRef) : resolve(ctx.directory, candidatePatchDiffRef);
        if (!isPathInsideRoot(absPath, ctx.directory)) {
          return { ok: false };
        }
        return { ok: true, absPath };
      },
      readPatchDiffBytes: (absPath) => readFileSync(absPath),
      sha256FromBytes: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    });
  };
  type HeldApplyLock = {
    release: () => Promise<void>;
  };
  const heldApplyLocksByCallId = new Map<string, HeldApplyLock>();
  const evaluateApplyGovernancePrerequisites = (sessionID: string): { ok: true } | { ok: false; reason: string } => {
    return evaluateApplyGovernancePrerequisitesShared({
      state: store.get(sessionID),
      config,
      digestFromPatchDiffRef,
      evaluateCouncilPolicy,
    });
  };
  const acquireApplyLockForCriticalSection = async (
    sessionID: string,
    callID: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!config.apply_lock.enabled || !config.apply_lock.fail_closed) {
      return { ok: true };
    }
    const lock = new SingleWriterApplyLock({
      projectDir: ctx.directory,
      sessionID,
      staleAfterMs: config.apply_lock.stale_lock_recovery_ms,
    });
    let releaseHold: (() => void) | null = null;
    const holdPromise = new Promise<void>((resolveHold) => {
      releaseHold = resolveHold;
    });

    const pendingLockResult = lock.withLock(async () => {
      await holdPromise;
      return { ok: true as const };
    });
    const immediateResult = await Promise.race<Awaited<typeof pendingLockResult> | "__pending__">([
      pendingLockResult,
      new Promise<"__pending__">((resolvePending) => {
        setTimeout(() => resolvePending("__pending__"), 0);
      }),
    ]);

    if (immediateResult !== "__pending__" && !immediateResult.ok) {
      if (immediateResult.reason === "denied") {
        return {
          ok: false,
          reason: `governance_apply_lock_denied:holder_session=${immediateResult.holder.sessionID}:holder_pid=${immediateResult.holder.pid}`,
        };
      }
      return { ok: false, reason: `governance_apply_lock_error:${immediateResult.message}` };
    }

    heldApplyLocksByCallId.set(callID, {
      release: async () => {
        if (releaseHold) {
          releaseHold();
          releaseHold = null;
        }
        const result = await pendingLockResult;
        if (!result.ok) {
          return;
        }
        const state = store.get(sessionID);
        store.update(sessionID, {
          governance: {
            ...state.governance,
            applyLock: {
              lockID: `${result.holder.pid}:${result.holder.acquiredAtMs}`,
              ownerSessionID: result.holder.sessionID,
              ownerProviderFamily: state.governance.patch.authorProviderFamily,
              ownerSubagent: state.lastTaskSubagent,
              acquiredAt: result.holder.acquiredAtMs,
            },
          },
        });
      },
    });

    return { ok: true };
  };
  const enforceApplyGovernanceOrThrow = async (params: {
    sessionID: string;
    callID: string;
    source: "task" | "bash";
    detail: string;
  }): Promise<void> => {
    const pre = evaluateApplyGovernancePrerequisites(params.sessionID);
    if (!pre.ok) {
      throw new AegisPolicyDenyError(`governance_apply_blocked:${pre.reason}`);
    }
    const lock = await acquireApplyLockForCriticalSection(params.sessionID, params.callID);
    if (!lock.ok) {
      throw new AegisPolicyDenyError(`governance_apply_blocked:${lock.reason}`);
    }
    safeNoteWrite("governance.apply_gate", () => {
      notesStore.recordScan(
        `apply gate lock acquired: source=${params.source} detail=${params.detail.slice(0, 180)} session=${params.sessionID}`
      );
    });
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
    if (!config.claude_hooks.enabled) {
      return;
    }
    const result = await runClaudeHook({
      projectDir: ctx.directory,
      hookName,
      payload,
      timeoutMs: config.claude_hooks.max_runtime_ms,
    });
    if (!result.ok) {
      throw new AegisPolicyDenyError(result.reason);
    }
  };
  const runClaudeCompatHookBestEffort = async (
    hookName: "PreToolUse" | "PostToolUse",
    payload: Record<string, unknown>
  ): Promise<void> => {
    if (!config.claude_hooks.enabled) {
      return;
    }
    const result = await runClaudeHook({
      projectDir: ctx.directory,
      hookName,
      payload,
      timeoutMs: config.claude_hooks.max_runtime_ms,
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

  const lockPath = join(notesStore.getRootDirectory(), "instance.lock");
  const lockResult = tryAcquireInstanceLock(lockPath);
  if (!lockResult.ok && lockResult.reason === "already_running") {
    safeNoteWrite("instance.lock", () => {
      notesStore.recordScan(`[warn] Another instance may be running (PID ${lockResult.holder?.pid}). Operating in advisory mode.`);
    });
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
  const startupTerminalBannerShownBySession = new Set<string>();
  const topLevelSessionIDs = new Set<string>();
  let npmAutoUpdateTriggered = false;
  const maybeWriteStartupTerminalBanner = (sessionID: string): void => {
    if (!config.tui_notifications.startup_terminal_banner) {
      return;
    }
    if (typeof process.env.TMUX !== "string" || process.env.TMUX.trim() === "") {
      return;
    }
    if (!sessionID || startupTerminalBannerShownBySession.has(sessionID)) {
      return;
    }
    startupTerminalBannerShownBySession.add(sessionID);

    const lines = [
      "",
      "============================================================",
      `oh-my-Aegis v${AEGIS_VERSION}`,
      "Aegis is orchestrating your workflow.",
      "============================================================",
      "",
    ];
    try {
      process.stdout.write(`${lines.join("\n")}\n`);
    } catch {
    }
  };

  const emitToast = async (params: {
    title: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
    durationMs: number;
  }): Promise<boolean> => {
    const tuiApi = (ctx.client as any)?.tui;
    const rawToastFn = tuiApi?.showToast;
    if (typeof rawToastFn !== "function") {
      return false;
    }
    const toastFn = (rawToastFn as (args: unknown) => Promise<unknown>).bind(tuiApi);
    const title = params.title.slice(0, 80);
    const message = params.message.slice(0, 240);
    const attempts: unknown[] = [
      {
        body: {
          title,
          message,
          variant: params.variant,
          duration: params.durationMs,
        },
      },
      {
        directory: ctx.directory,
        title,
        message,
        variant: params.variant,
        duration: params.durationMs,
      },
      {
        query: { directory: ctx.directory },
        body: {
          title,
          message,
          variant: params.variant,
          duration: params.durationMs,
        },
      },
    ];
    for (const args of attempts) {
      try {
        await toastFn(args);
        return true;
      } catch {
      }
    }
    return false;
  };

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
    const now = Date.now();
    const throttleMs = config.tui_notifications.throttle_ms;
    const mapKey = `${params.sessionID}:${params.key}`;
    const last = toastLastAtBySessionKey.get(mapKey) ?? 0;
    if (throttleMs > 0 && now - last < throttleMs) {
      return;
    }
    toastLastAtBySessionKey.set(mapKey, now);
    const duration = params.durationMs ?? 4_000;
    await emitToast({
      title: params.title,
      message: params.message,
      variant: params.variant,
      durationMs: duration,
    });
  };

  const showStartupToast = async ({ sessionID }: { sessionID: string }): Promise<boolean> => {
    const tuiApi = (ctx.client as any)?.tui;
    const rawShowToast = tuiApi?.showToast;
    if (typeof rawShowToast !== "function") {
      return false;
    }
    const showToast = (rawShowToast as (args: unknown) => Promise<unknown>).bind(tuiApi);
    const STARTUP_SPINNER_FRAMES = ["·", "•", "●", "○", "◌", "◦", " "];
    const frameIntervalMs = 100;
    const totalDurationMs = 5_000;
    const totalFrames = 50;
    const maxFrames = Math.min(totalFrames, Math.floor(totalDurationMs / frameIntervalMs));
    const duration = frameIntervalMs + 50;
    const message = "Aegis is orchestrating your workflow.";

    for (let frame = 0; frame < maxFrames; frame += 1) {
      const spinner = STARTUP_SPINNER_FRAMES[frame % STARTUP_SPINNER_FRAMES.length];
      await showToast({
        body: {
          title: `${spinner} oh-my-Aegis ${AEGIS_VERSION}`,
          message,
          variant: "info",
          duration,
        },
      });

      if (frame < maxFrames - 1) {
        await new Promise((resolve) => setTimeout(resolve, frameIntervalMs));
      }
    }
    return true;
  };
  const { maybeHandleStartupAnnouncement, maybeScheduleStartupToastFallback } = createStartupToastManager({
    startupToastEnabled: config.tui_notifications.startup_toast,
    showToast: showStartupToast,
    onTopLevelSession: (sessionID) => {
      topLevelSessionIDs.add(sessionID);
      maybeWriteStartupTerminalBanner(sessionID);
    },
  });

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
      const path = join(notesStore.getRootDirectory(), "metrics.jsonl");
      appendJsonlRecord(path, entry);
    } catch (error) {
      noteHookError("metrics.append", error);
    }
  };

  const stableActionSignature = (toolName: string, args: unknown): string => {
    return stableActionSignatureHelper(toolName, args, {
      isRecord,
      hashAction: (input) => createHash("sha256").update(input).digest("hex").slice(0, 12),
    });
  };

  const LOOP_GUARD_BOOKKEEPING_EVENTS = new Set([
    "oracle_progress",
    "contradiction_sla_dump_done",
    "unsat_cross_validated",
    "unsat_unhooked_oracle",
    "unsat_artifact_digest",
    "replay_low_trust",
    "readonly_inconclusive",
  ]);
  const LOOP_DEBT_HELPER_TOOLS = new Set([
    "todowrite",
    "read",
    "grep",
    "glob",
    "ast_grep_search",
    "ast_grep_replace",
    "lsp_goto_definition",
    "lsp_find_references",
    "lsp_symbols",
    "lsp_diagnostics",
    "lsp_prepare_rename",
    "lsp_rename",
    "ctf_ast_grep_search",
    "ctf_ast_grep_replace",
    "ctf_lsp_goto_definition",
    "ctf_lsp_find_references",
    "ctf_lsp_diagnostics",
  ]);
  const isLoopDebtHelperTool = (toolName: string): boolean => {
    return LOOP_DEBT_HELPER_TOOLS.has(toolName);
  };
  const isBookkeepingOrchEventArgs = (args: unknown): boolean => {
    if (!isRecord(args)) {
      return false;
    }
    const event = typeof args.event === "string" ? args.event.trim().toLowerCase() : "";
    return LOOP_GUARD_BOOKKEEPING_EVENTS.has(event);
  };
  const shouldTrackToolPattern = (toolName: string, args: unknown): boolean => {
    if (isLoopDebtHelperTool(toolName)) {
      return false;
    }
    if (toolName === "ctf_orch_event" && isBookkeepingOrchEventArgs(args)) {
      return false;
    }
    return true;
  };
  const buildLoopGuardArgs = (
    sessionID: string,
    args: unknown,
    failureClassOverride?: string,
  ): unknown => {
    const state = store.get(sessionID);
    const explicitRoute =
      isRecord(args) && typeof args.subagent_type === "string" ? args.subagent_type.trim() : "";
    const routeName = explicitRoute || state.lastTaskRoute || route(state, config).primary;
    const failureClass = (failureClassOverride ?? state.lastFailureReason).trim().toLowerCase();
    const meta = {
      route: routeName,
      failure_class: failureClass,
    };
    if (isRecord(args)) {
      return { ...args, __aegis_meta: meta };
    }
    return { __aegis_meta: meta, value: args ?? {} };
  };

  const applyLoopGuard = (sessionID: string, toolName: string, args: unknown): void => {
    applyLoopGuardHelper({
      sessionID,
      toolName,
      args,
      stuckThreshold: config.stuck_threshold,
      getState: (targetSessionID) => store.get(targetSessionID),
      setLoopGuardBlock: (targetSessionID, signature, reason) => {
        store.setLoopGuardBlock(targetSessionID, signature, reason);
      },
      recordActionSignature: (targetSessionID, signature) => {
        store.recordActionSignature(targetSessionID, signature);
      },
      stableActionSignature,
      createPolicyDenyError: (message) => new AegisPolicyDenyError(message),
    });
  };

  const normalizeTodoEntries = (todos: unknown[]): AegisTodoEntry[] => {
    return normalizeTodoEntriesHelper(todos, isRecord);
  };

  const sameTodoIdentity = (left: AegisTodoEntry, right: AegisTodoEntry): boolean => {
    if (left.id && right.id && left.id === right.id) {
      return true;
    }
    return left.content === right.content;
  };

  const isTodoTerminal = (todo: AegisTodoEntry): boolean => {
    return todo.status === "completed" || todo.status === "cancelled";
  };

  const buildSharedChannelPrompt = (sessionID: string, subagentType: string): string => {
    return buildSharedChannelPromptHelper(sessionID, subagentType, (targetSessionID, channelID, sinceSeq, limit) =>
      store.readSharedMessages(targetSessionID, channelID, sinceSeq, limit)
    );
  };

  type SharedBashPolicyEvaluation = {
    state: ReturnType<typeof store.get>;
    command: string;
    decision: ReturnType<typeof evaluateBashCommand>;
  };

  const evaluateSharedBashPolicy = (sessionID: string, commandPayload: unknown): SharedBashPolicyEvaluation => {
    const state = store.get(sessionID);
    const command = extractBashCommand(commandPayload);
    const scopePolicy = state.mode === "BOUNTY" ? getBountyScopePolicy() : null;
    const decision = evaluateBashCommand(command, config, state.mode, {
      scopeConfirmed: state.scopeConfirmed,
      scopePolicy,
      now: new Date(),
      godMode: godModeEnabled,
    });
    return { state, command, decision };
  };

  const setSoftBashOverrideForCall = (callID: string, reason: string, command: string): void => {
    softBashOverrideByCallId.set(callID, {
      addedAt: Date.now(),
      reason,
      command,
    });
  };

  const consumeSoftBashOverrideForCall = (callID: string): { reason: string; command: string } | null => {
    pruneSoftBashOverrides();
    const override = softBashOverrideByCallId.get(callID);
    if (!override) {
      return null;
    }
    softBashOverrideByCallId.delete(callID);
    return {
      reason: override.reason,
      command: override.command,
    };
  };

  const { logRouteDecision } = createRouteLogger({
    getRootDirectory: () => notesStore.getRootDirectory(),
    isNotesReady: () => notesReady,
    appendRecord: (record) => {
      const path = join(notesStore.getRootDirectory(), "route_decisions.jsonl");
      appendJsonlRecord(path, record);
    },
    onError: (error) => noteHookError("route-log.append", error),
    isStuck,
    config,
  });

  const maybeAutoloopTick = createAutoLoopRunner({
    config,
    store,
    client: ctx.client,
    directory: ctx.directory,
    note: (label, message) => {
      safeNoteWrite(label, () => {
        notesStore.recordScan(message);
      });
    },
    noteHookError,
    maybeShowToast,
    logRouteDecision,
    route,
    buildWorkPackage,
    consumeSearchModeGuidance: (sessionID) => {
      if (!(searchModeRequestedBySession.has(sessionID) && searchModeGuidancePendingBySession.has(sessionID))) {
        return false;
      }
      searchModeGuidancePendingBySession.delete(sessionID);
      return true;
    },
  });

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

  const appendOrchestrationLedgerFromRuntime = (
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

        const startupHandled = maybeHandleStartupAnnouncement(type, props);
        if (startupHandled.handled) {
          return;
        }

        if (type === "session.idle") {
          const sessionID = typeof props.sessionID === "string" ? props.sessionID : "";
          if (sessionID) {
            maybeScheduleStartupToastFallback(sessionID);
            await maybeAutoloopTick(sessionID, "session.idle");
          }
          return;
        }

        if (type === "session.status") {
          const sessionID = typeof props.sessionID === "string" ? props.sessionID : "";
          const status = props.status as { type?: string } | undefined;
          if (sessionID && status?.type === "idle") {
            maybeScheduleStartupToastFallback(sessionID);
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
              edit: godModeEnabled ? "allow" : "deny",
              bash: godModeEnabled ? "allow" : "deny",
              webfetch: "allow",
              external_directory: godModeEnabled ? "allow" : "deny",
              doom_loop: godModeEnabled ? "allow" : "deny",
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

        if (godModeEnabled) {
          for (const [name, candidate] of Object.entries(nextAgents)) {
            if (!isRecord(candidate)) {
              continue;
            }
            const permission = isRecord((candidate as Record<string, unknown>).permission)
              ? ((candidate as Record<string, unknown>).permission as Record<string, unknown>)
              : {};
            nextAgents[name] = {
              ...(candidate as AgentConfig),
              permission: {
                ...permission,
                edit: "allow",
                bash: "allow",
                webfetch: "allow",
                external_directory: "allow",
                doom_loop: "allow",
              },
            };
          }
        }

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

        if (isUserMessage && !npmAutoUpdateTriggered) {
          npmAutoUpdateTriggered = true;
          void (async () => {
            try {
              const result = await maybeNpmAutoUpdatePackage({
                packageName: "oh-my-aegis",
                installDir: resolveOpencodeCacheDir(),
                currentVersion: AEGIS_VERSION,
                silent: true,
              });
              safeNoteWrite("npm.auto_update", () => {
                notesStore.recordScan(`npm auto-update: ${result.status} (${result.detail})`);
              });
            } catch {
            }
          })();
        }

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

        if (isUserMessage && /\[search-mode\]/i.test(contextText)) {
          searchModeRequestedBySession.add(input.sessionID);
          searchModeGuidancePendingBySession.add(input.sessionID);
          safeNoteWrite("search_mode.enabled", () => {
            notesStore.recordScan(`Search-mode requested: session=${input.sessionID}`);
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
        if (freeTextSignalsEnabled && isUserMessage) {
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
      let governanceApplyGatePath = false;
      const releaseHeldApplyLockForCurrentCall = async (): Promise<void> => {
        const heldApplyLock = heldApplyLocksByCallId.get(input.callID);
        if (!heldApplyLock) {
          return;
        }
        heldApplyLocksByCallId.delete(input.callID);
        try {
          await heldApplyLock.release();
          safeNoteWrite("governance.apply_gate", () => {
            notesStore.recordScan(`apply gate lock released during prehook exit: session=${input.sessionID} call=${input.callID}`);
          });
        } catch (releaseError) {
          noteHookError("governance.apply_gate.release", releaseError);
        }
      };

      const stateForGate = store.get(input.sessionID);
      const callerAgentFromInput =
        typeof (input as { agent?: unknown }).agent === "string"
          ? baseAgentName(((input as { agent?: string }).agent ?? "").trim()).toLowerCase()
          : "";
      const callerAgent = callerAgentFromInput || activeAgentBySession.get(input.sessionID) || "";

      const stageModeExplicitGate = (): void => {
        const isAegisOrCtfTool = input.tool.startsWith("ctf_") || input.tool.startsWith("aegis_");
        const modeActivationBypassTools = new Set(["ctf_orch_set_mode", "ctf_orch_status"]);
        if (!stateForGate.modeExplicit && isAegisOrCtfTool && !modeActivationBypassTools.has(input.tool)) {
          throw new AegisPolicyDenyError(
            "oh-my-Aegis is inactive until mode is explicitly declared. Use `MODE: CTF`, `MODE: BOUNTY`, or run `ctf_orch_set_mode` first."
          );
        }
      };

      const stageManagerDirectToolGate = (): void => {
        if (callerAgent === "aegis" && !isAegisManagerAllowedTool(input.tool)) {
          throw new AegisPolicyDenyError(
            `Aegis manager cannot execute '${input.tool}' directly. Use only manager-safe discovery/orchestration tools directly; delegate edits or active execution to subagents via task (with explicit subagent_type) and review results via orchestration tools.`
          );
        }
      };

      const stageTodowritePolicyCluster = (): boolean => {
        if (input.tool !== "todowrite") {
          return false;
        }

        const state = store.get(input.sessionID);
        const args = isRecord(output.args) ? output.args : {};
        const todos = normalizeTodoEntries(Array.isArray(args.todos) ? args.todos : []);
        args.todos = todos;

        const lockedTodo = state.todoRuntime.canonical.find((todo) => todo.status === "in_progress") ?? null;
        if (lockedTodo) {
          const lockedIndex = todos.findIndex((todo) => sameTodoIdentity(todo, lockedTodo));
          const lockedResolved =
            lockedIndex >= 0 &&
            (todos[lockedIndex]?.status === "completed" || todos[lockedIndex]?.status === "cancelled");
          if (!lockedResolved) {
            if (lockedIndex === -1) {
              todos.unshift({ ...lockedTodo });
            } else {
              todos[lockedIndex] = {
                ...todos[lockedIndex],
                status: "in_progress",
                resolution: "none",
              };
            }
            for (const todo of todos) {
              if (!sameTodoIdentity(todo, lockedTodo) && todo.status === "in_progress") {
                todo.status = "pending";
              }
            }
            safeNoteWrite("todowrite.lock", () => {
              notesStore.recordScan(
                `Todo lock preserved active item until explicit completion/block: ${lockedTodo.content.slice(0, 120)}`
              );
            });
          }
        }

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
          const activeTodoStillLocked = Boolean(
            lockedTodo &&
              !todos.some((todo) => sameTodoIdentity(todo, lockedTodo) && isTodoTerminal(todo))
          );

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
              id: "synthetic-start",
              content: SYNTHETIC_START_TODO,
              status: "in_progress",
              priority: "high",
              resolution: "none",
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
                id: `synthetic-breakdown-${existingSyntheticBreakdownCount + i + 1}`,
                content: `${SYNTHETIC_BREAKDOWN_PREFIX}${existingSyntheticBreakdownCount + i + 1}.`,
                status: "pending",
                priority: "medium",
                resolution: "none",
              });
            }
            safeNoteWrite("todowrite.granularity", () => {
              notesStore.recordScan(
                `Todo granularity enforced (non-SCAN): expanded todo set to at least ${minTodos} items.`
              );
            });
          }

          const counts = todoStatusCounts(todos);
          if (!terminalCtfSuccess && counts.pending > 0 && counts.inProgress === 0 && !activeTodoStillLocked) {
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
          if (!terminalCtfSuccess && finalCounts.open === 0 && todos.length > 0 && !activeTodoStillLocked) {
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
                id: "synthetic-continue",
                content: SYNTHETIC_CONTINUE_TODO,
                status: "in_progress",
                priority: "high",
                resolution: "none",
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
              id: `synthetic-ctf-loop-${decision.primary}`,
              content: `Continue CTF loop via '${decision.primary}' until submit_accepted (no early stop).`,
              status: "pending",
              priority: "high",
              resolution: "none",
            });
            safeNoteWrite("todowrite.continuation", () => {
              notesStore.recordScan(
                `Todo continuation enforced (ultrawork): added pending item for route '${decision.primary}'.`
              );
            });
          }
        }

        output.args = args;
        applyLoopGuard(input.sessionID, input.tool, buildLoopGuardArgs(input.sessionID, output.args));
        store.stageTodoRuntime(input.sessionID, input.callID, todos);
        return true;
      };

      const stageReadEditWriteDenyChecks = (): void => {
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
      };

      const stageLoopGuardEnforcement = (): void => {
        const rawArgs = (output as { args?: unknown }).args ?? {};
        applyLoopGuard(input.sessionID, input.tool, buildLoopGuardArgs(input.sessionID, rawArgs));
      };

      const stageTaskPromptShaping = (): { handled: boolean; args: Record<string, unknown>; state: ReturnType<typeof store.get> | null } => {
        if (input.tool !== "task") {
          return { handled: false, args: {}, state: null };
        }

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
          return { handled: true, args, state };
        }

        const contextShaped = shapeTaskPromptContext({
          args,
          state,
          godModeEnabled,
        });
        output.args = contextShaped.args;
        return { handled: false, args: contextShaped.args, state };
      };

      const stageAutoParallelInjection = (
        args: Record<string, unknown>,
        state: ReturnType<typeof store.get>
      ): void => {
        const decision = route(state, config);
        logRouteDecision(input.sessionID, state, decision, "task_dispatch");

        let shaped: ReturnType<typeof shapeTaskDispatch>;
        try {
          shaped = shapeTaskDispatch({
            args,
            state,
            config,
            callerAgent,
            sessionID: input.sessionID,
            decisionPrimary: decision.primary,
            searchModeRequested: searchModeRequestedBySession.has(input.sessionID),
            searchModeGuidancePending: searchModeGuidancePendingBySession.has(input.sessionID),
            hasActiveParallelGroup: Boolean(getActiveGroup(input.sessionID)),
            availableSkills,
            isWindows: process.platform === "win32",
            resolveSharedChannelPrompt: (subagentType) =>
              buildSharedChannelPrompt(input.sessionID, subagentType),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new AegisPolicyDenyError(message);
        }

        if (shaped.clearSearchModeGuidancePending) {
          searchModeGuidancePendingBySession.delete(input.sessionID);
        }

        for (const instruction of shaped.storeInstructions) {
          if (instruction.type === "setLastTaskCategory") {
            store.setLastTaskCategory(input.sessionID, instruction.value);
            continue;
          }
          if (instruction.type === "setLastDispatch") {
            store.setLastDispatch(
              input.sessionID,
              instruction.route,
              instruction.subagent,
              instruction.model,
              instruction.variant
            );
            continue;
          }
          if (instruction.type === "consumeTaskFailover") {
            store.consumeTaskFailover(input.sessionID);
            continue;
          }
          if (instruction.type === "setThinkMode") {
            store.setThinkMode(input.sessionID, instruction.value);
            continue;
          }
          if (instruction.type === "appendRecentEvent") {
            state.recentEvents.push(instruction.value);
            if (state.recentEvents.length > instruction.cap) {
              state.recentEvents = state.recentEvents.slice(-instruction.cap);
            }
          }
        }

        for (const note of shaped.notes) {
          safeNoteWrite(note.key, () => {
            notesStore.recordScan(note.message);
          });
        }

        output.args = shaped.args;
      };

      const stageBashPolicyEvaluation = (): void => {
        if (input.tool !== "bash") {
          return;
        }

        const { command, decision } = evaluateSharedBashPolicy(input.sessionID, output.args);

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

        if (!decision.allow) {
          const denyLevel = decision.denyLevel ?? "hard";
          if (denyLevel === "soft") {
            const override = consumeSoftBashOverrideForCall(input.callID);
            if (override) {
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
      };

      const stageApplyGovernanceGate = async (): Promise<void> => {
        if (input.tool === "task") {
          const args = (output.args ?? {}) as Record<string, unknown>;
          const taskPromptForApplyGate = typeof args.prompt === "string" ? args.prompt : "";
          if (isApplyTransitionAttempt(taskPromptForApplyGate)) {
            governanceApplyGatePath = true;
            await enforceApplyGovernanceOrThrow({
              sessionID: input.sessionID,
              callID: input.callID,
              source: "task",
              detail: taskPromptForApplyGate,
            });
          }
          return;
        }

        if (input.tool === "bash") {
          const command = extractBashCommand(output.args);
          if (isApplyTransitionAttempt(command)) {
            governanceApplyGatePath = true;
            await enforceApplyGovernanceOrThrow({
              sessionID: input.sessionID,
              callID: input.callID,
              source: "bash",
              detail: command,
            });
          }
        }
      };

      const stageCentralizedLatencyErrorHandling = async (): Promise<void> => {
        await runClaudeCompatHookOrThrow("PreToolUse", {
          session_id: input.sessionID,
          call_id: input.callID,
          tool_name: input.tool,
          tool_input: isRecord(output.args) ? output.args : {},
        });

        stageModeExplicitGate();
        stageManagerDirectToolGate();
        if (stageTodowritePolicyCluster()) {
          return;
        }
        stageReadEditWriteDenyChecks();
        stageLoopGuardEnforcement();
        const taskStage = stageTaskPromptShaping();
        if (taskStage.handled) {
          return;
        }
        await stageApplyGovernanceGate();
        if (taskStage.state) {
          stageAutoParallelInjection(taskStage.args, taskStage.state);
          return;
        }
        stageBashPolicyEvaluation();
      };

      try {
        await stageCentralizedLatencyErrorHandling();
      } catch (error) {
        await releaseHeldApplyLockForCurrentCall();
        if (error instanceof AegisPolicyDenyError) {
          throw error;
        }
        noteHookError("tool.execute.before", error);
        if (governanceApplyGatePath) {
          throw new AegisPolicyDenyError("governance_apply_blocked:governance_internal_error");
        }
      } finally {
        maybeRecordHookLatency("tool.execute.before", input, hookStartedAt);
      }
    },

    "permission.ask": async (input, output) => {
      try {
        if (input.type.toLowerCase() !== "bash") {
          return;
        }

        const { command, decision } = evaluateSharedBashPolicy(input.sessionID, input.metadata);
        output.status = "ask";
        if (!decision.allow) {
          const denyLevel = decision.denyLevel ?? "hard";
          if (denyLevel === "soft") {
            if (input.callID) {
              pruneSoftBashOverrides();
              setSoftBashOverrideForCall(input.callID, decision.reason ?? "", decision.sanitizedCommand ?? command);
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
        const callerAgentFromInput =
          typeof (input as { agent?: unknown }).agent === "string"
            ? baseAgentName(((input as { agent?: string }).agent ?? "").trim()).toLowerCase()
            : "";
        const callerAgent = callerAgentFromInput || activeAgentBySession.get(input.sessionID) || "";

        const heldApplyLock = heldApplyLocksByCallId.get(input.callID);
        if (heldApplyLock) {
          heldApplyLocksByCallId.delete(input.callID);
          await heldApplyLock.release();
          safeNoteWrite("governance.apply_gate", () => {
            notesStore.recordScan(`apply gate lock released: session=${input.sessionID} call=${input.callID}`);
          });
        }

        await runClaudeCompatHookBestEffort("PostToolUse", {
          session_id: input.sessionID,
          call_id: input.callID,
          tool_name: input.tool,
          tool_title: output.title,
        });

        if (input.tool === "todowrite") {
          const committedArgs = isRecord((output as { args?: unknown }).args)
            ? ((output as { args?: unknown }).args as Record<string, unknown>)
            : {};
          const committedTodos = normalizeTodoEntries(Array.isArray(committedArgs.todos) ? committedArgs.todos : []);
          store.commitTodoRuntime(input.sessionID, input.callID, committedTodos);
        }

        const originalTitle = output.title;
        const originalOutput = output.output;
        const raw = `${originalTitle}\n${originalOutput}`;
        const classifiedFailure = classifyFailureReason(raw);
        const classifiedFailureSafe = classifiedFailure ?? "none";
        const metricSignals: string[] = [];
        const metricExtras: Record<string, unknown> = {};
        const parsedToolOutput = typeof originalOutput === "string" ? safeJsonParseObject(originalOutput) : null;
        const toolArgsForTracking = (output as { args?: unknown }).args ?? (input as { args?: unknown }).args ?? {};
        const shouldTrackLoopDebt = shouldTrackToolPattern(input.tool, toolArgsForTracking);

        const governanceStage = captureGovernanceArtifactsStage({
          tool: input.tool,
          sessionID: input.sessionID,
          parsedToolOutput,
          state: store.get(input.sessionID),
          digestFromPatchDiffRef,
          evaluateIndependentReviewGate,
          providerFamilyFromModel,
          config,
        });
        if (governanceStage.patchProposalUpdate) {
          const state = store.get(input.sessionID);
          store.update(input.sessionID, {
            governance: {
              ...state.governance,
              patch: {
                ...state.governance.patch,
                proposalRefs: governanceStage.patchProposalUpdate.proposalRefs,
                digest: governanceStage.patchProposalUpdate.digest,
                authorProviderFamily: providerFamilyFromModel(governanceStage.patchProposalUpdate.authorModel),
              },
            },
          });
        }
        if (governanceStage.reviewUpdate) {
          const state = store.get(input.sessionID);
          store.update(input.sessionID, {
            governance: {
              ...state.governance,
              patch: {
                ...state.governance.patch,
                authorProviderFamily: governanceStage.reviewUpdate.authorProviderFamily as typeof state.governance.patch.authorProviderFamily,
                reviewerProviderFamily: governanceStage.reviewUpdate.reviewerProviderFamily as typeof state.governance.patch.reviewerProviderFamily,
              },
              review: {
                verdict: governanceStage.reviewUpdate.verdict,
                digest: governanceStage.reviewUpdate.digest,
                reviewedAt: governanceStage.reviewUpdate.reviewedAt,
              },
            },
          });
        }
        if (governanceStage.councilUpdate) {
          const state = store.get(input.sessionID);
          store.update(input.sessionID, {
            governance: {
              ...state.governance,
              council: {
                decisionArtifactRef: governanceStage.councilUpdate.decisionArtifactRef,
                decidedAt: governanceStage.councilUpdate.decidedAt,
              },
            },
          });
        }
        metricSignals.push(...governanceStage.metricSignals);

        // 도구 호출 카운터 업데이트
        {
          const isAegisTool =
            input.tool.startsWith("ctf_") || input.tool.startsWith("aegis_");
          const curState = store.get(input.sessionID);
          const historyEntry = shouldTrackLoopDebt
            ? stableActionSignature(
              input.tool,
              buildLoopGuardArgs(input.sessionID, toolArgsForTracking, classifiedFailureSafe)
            )
            : "";
          const history =
            shouldTrackLoopDebt && historyEntry.length > 0
              ? [...curState.toolCallHistory, historyEntry].slice(-20)
              : curState.toolCallHistory;
          store.update(input.sessionID, {
            toolCallCount: curState.toolCallCount + 1,
            aegisToolCallCount: curState.aegisToolCallCount + (isAegisTool ? 1 : 0),
            lastToolCallAt: Date.now(),
            toolCallHistory: history,
          });
        }

        if (input.tool === "ctf_parallel_dispatch") {
          let dispatchOk = false;
          if (typeof originalOutput === "string" && originalOutput.trim().length > 0) {
            try {
              const parsed = JSON.parse(originalOutput) as { ok?: unknown };
              dispatchOk = parsed.ok === true;
            } catch {
              dispatchOk = /"ok"\s*:\s*true/.test(originalOutput);
            }
          }
          if (dispatchOk) {
            searchModeRequestedBySession.delete(input.sessionID);
            searchModeGuidancePendingBySession.delete(input.sessionID);
            safeNoteWrite("search_mode.clear", () => {
              notesStore.recordScan(`Search-mode cleared after successful parallel dispatch: session=${input.sessionID}`);
            });
          }
        }

        if (input.tool === "task") {
          const stateForPlan = store.get(input.sessionID);
          const planSnapshot = buildPlanSnapshotStage({
            tool: input.tool,
            lastTaskCategory: baseAgentName(stateForPlan.lastTaskCategory || ""),
            originalOutput,
            sessionID: input.sessionID,
            nowIso: new Date().toISOString(),
          });
          if (planSnapshot.shouldWrite) {
            safeNoteWrite("plan.snapshot", () => {
              const root = notesStore.getRootDirectory();
              const planPath = join(root, "PLAN.md");
              writeFileSync(planPath, planSnapshot.content, "utf-8");
              notesStore.recordScan(`Plan snapshot updated: ${relative(ctx.directory, planPath)}`);
            });
          }
        }

        // Phase 자동 전환 heuristic
        if (config.auto_phase.enabled) {
          const apState = store.get(input.sessionID);
          const hasNonEmptyToolOutput =
            (typeof originalOutput === "string" && originalOutput.trim().length > 0) ||
            textFromUnknown(originalOutput).trim().length > 0;

          const isScanEvidenceFromAutoTriage =
            input.tool === "ctf_auto_triage" && hasNonEmptyToolOutput;

          const bashCommandFromMetadata = extractBashCommand((input as { metadata?: unknown }).metadata);
          const bashCommandFromArgs = extractBashCommand((input as { args?: unknown }).args);
          const bashCommand = bashCommandFromMetadata || bashCommandFromArgs;
          const isScanEvidenceFromBash =
            input.tool === "bash" &&
            hasNonEmptyToolOutput &&
            /\b(file|strings|readelf|checksec)\b/i.test(bashCommand);

          const hasScanEvidence = isScanEvidenceFromAutoTriage || isScanEvidenceFromBash;
          const scanFallbackReached =
            apState.toolCallCount >= config.auto_phase.scan_to_plan_tool_count;

          if (apState.phase === "SCAN" && (hasScanEvidence || scanFallbackReached)) {
            store.applyEvent(input.sessionID, "scan_completed");
            metricSignals.push("auto_phase:scan_to_plan");
          } else if (
            apState.phase === "PLAN" &&
            config.auto_phase.plan_to_execute_on_todo &&
            input.tool === "todowrite" &&
            apState.lastFailureReason !== "input_validation_non_retryable"
          ) {
            const todowritePayloadCandidates = [
              (input as { args?: unknown }).args,
              (input as { metadata?: unknown }).metadata,
              output.metadata,
            ];
            const hasInProgressTodo = todowritePayloadCandidates.some((candidate) => {
              if (!isRecord(candidate)) {
                return false;
              }
              if (Array.isArray(candidate.todos)) {
                return inProgressTodoCount(candidate) > 0;
              }
              if (!isRecord(candidate.args) || !Array.isArray(candidate.args.todos)) {
                return false;
              }
              return inProgressTodoCount(candidate.args) > 0;
            });
            if (hasInProgressTodo) {
              store.applyEvent(input.sessionID, "plan_completed");
              metricSignals.push("auto_phase:plan_to_execute");
            }
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
          if (shouldTrackLoopDebt) {
            store.applyEvent(input.sessionID, "context_length_exceeded");
            metricSignals.push("context_length_exceeded");
          }
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
          if (shouldTrackLoopDebt) {
            store.applyEvent(input.sessionID, "timeout");
            metricSignals.push("timeout");
          }
        }

        const stateBeforeVerifyCheck = store.get(input.sessionID);
        const lastRouteBase = baseAgentName(stateBeforeVerifyCheck.lastTaskRoute || "");
        const contradictionArtifacts = contradictionArtifactStage({
          tool: input.tool,
          state: stateBeforeVerifyCheck,
          lastRouteBase,
          artifactHints: extractArtifactPathHints(raw),
        });
        if (contradictionArtifacts.length > 0) {
          store.recordContradictionArtifacts(input.sessionID, contradictionArtifacts);
          metricSignals.push("contradiction_artifacts_recorded");
          metricExtras.contradictionArtifactsRecorded = contradictionArtifacts;
          safeNoteWrite("contradiction.artifact", () => {
            notesStore.recordScan(
              `Contradiction artifact lock released: recorded artifact paths ${contradictionArtifacts.join(", ")}`
            );
          });
        }
        const verificationStage = routeVerifierStage({
          tool: input.tool,
          lastTaskRoute: lastRouteBase,
          isVerificationSourceRelevant: isVerificationSourceRelevant(
            input.tool,
            output.title,
            {
              verifierToolNames: config.verification.verifier_tool_names,
              verifierTitleMarkers: config.verification.verifier_title_markers,
            }
          ),
          raw,
          parseOracleProgressFromText,
        });
        const verificationRelevant = verificationStage.verificationRelevant;
        const parsedOracleProgress = verificationStage.parsedOracleProgress;

        if (stateBeforeVerifyCheck.targetType === "REV" && input.tool === "bash") {
          const bashCommand = extractBashCommand((input as { metadata?: unknown }).metadata);
          const revDetectorCommand = /\b(strings|readelf|checksec)\b/i;
          if (revDetectorCommand.test(bashCommand)) {
            const commandLower = bashCommand.toLowerCase();
            const stringsOutput = /\bstrings\b/.test(commandLower) ? raw : "";
            const readelfOutput = /\breadelf\b/.test(commandLower) ? raw : "";
            const readelfSections = /\breadelf\b/.test(commandLower) && /(?:^|\s)-S(?:\s|$)/.test(bashCommand)
              ? raw
              : readelfOutput;
            const readelfRelocs = /\breadelf\b/.test(commandLower) && /(?:^|\s)-r(?:\s|$)/.test(bashCommand)
              ? raw
              : readelfOutput;

            const revRisk = assessRevVmRisk(raw);
            if (revRisk.signals.length > 0) {
              store.setRevRisk(input.sessionID, revRisk);
              appendOrchestrationLedgerFromRuntime(
                input.sessionID,
                "rev_vm_detect",
                "static_reverse",
                Math.max(0, Math.min(1, revRisk.score)),
                `REV VM risk signals: ${revRisk.signals.join(", ")}`,
                "tool.execute.after"
              );
            }

            const indicator = detectRevLoaderVm(readelfSections, readelfRelocs, stringsOutput);
            const forcedByDetector = shouldForceRelocPatchDump(indicator);
            const forcedByRelocMemfd =
              /(?:\.rela\.p|\.sym\.p)/i.test(raw) && /(?:memfd_create|fexecve)/i.test(raw);
            const forcedBySignalCount = indicator.signals.length >= 3;
            const forceExtractionFirst = forcedByDetector || forcedByRelocMemfd || forcedBySignalCount;

            if (forceExtractionFirst) {
              const stateForTransition = store.get(input.sessionID);
              const needsTransition =
                !stateForTransition.revVmSuspected ||
                !stateForTransition.revLoaderVmDetected ||
                stateForTransition.revStaticTrust !== 0 ||
                !stateForTransition.contradictionArtifactLockActive ||
                stateForTransition.contradictionPivotDebt < 2 ||
                !stateForTransition.contradictionSLADumpRequired;
              if (needsTransition) {
                store.update(input.sessionID, {
                  revVmSuspected: true,
                  revLoaderVmDetected: true,
                  revStaticTrust: 0,
                  contradictionArtifactLockActive: true,
                  contradictionPivotDebt: Math.max(stateForTransition.contradictionPivotDebt, 2),
                  contradictionSLADumpRequired: true,
                });
                const triggerSignals: string[] = [];
                if (forcedByDetector) triggerSignals.push("detector_force_reloc_patch_dump");
                if (forcedByRelocMemfd) triggerSignals.push("rela_or_sym_p_with_memfd_or_fexecve");
                if (forcedBySignalCount) triggerSignals.push(`signal_count=${indicator.signals.length}`);
                if (indicator.signals.length > 0) triggerSignals.push(...indicator.signals.slice(0, 8));
                appendOrchestrationLedgerFromRuntime(
                  input.sessionID,
                  "auto_rev_vm_detected",
                  "dynamic_memory",
                  0.9,
                  `Auto REV VM detect from bash '${bashCommand}': ${triggerSignals.join(", ") || "heuristic trigger"}`,
                  "tool.execute.after"
                );
              }
            }

            const replayCheck = isReplayUnsafe(stringsOutput, readelfOutput);
            if (replayCheck.unsafe) {
              const tokens = bashCommand.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
              const normalizedTokens = tokens.map((token) => token.replace(/^['"]|['"]$/g, ""));
              let replayBinaryKey = "";
              for (const token of normalizedTokens) {
                if (token.startsWith("--file=")) {
                  replayBinaryKey = token.slice("--file=".length);
                  break;
                }
              }
              if (!replayBinaryKey) {
                for (let i = 1; i < normalizedTokens.length; i += 1) {
                  const token = normalizedTokens[i];
                  if (!token || token.startsWith("-")) {
                    continue;
                  }
                  replayBinaryKey = token;
                  break;
                }
              }
              if (!replayBinaryKey) {
                replayBinaryKey = bashCommand.trim() || "bash:unknown_binary";
              }

              const stateForReplay = store.get(input.sessionID);
              const knownLowTrust = stateForReplay.replayLowTrustBinaries || [];
              if (!knownLowTrust.includes(replayBinaryKey)) {
                store.update(input.sessionID, {
                  replayLowTrustBinaries: [...knownLowTrust, replayBinaryKey],
                });
                store.applyEvent(input.sessionID, "replay_low_trust");
                appendOrchestrationLedgerFromRuntime(
                  input.sessionID,
                  "auto_replay_low_trust",
                  "dynamic_memory",
                  0.8,
                  `Auto replay low-trust for '${replayBinaryKey}': ${replayCheck.signals.join(", ")}`,
                  "tool.execute.after"
                );
              }
            }
          }
        }

        if (input.tool === "ctf_oracle_progress" && typeof originalOutput === "string") {
          try {
            const parsed = JSON.parse(originalOutput) as {
              progress?: {
                passRate?: number;
                improved?: boolean;
                passCount?: number;
                totalTests?: number;
              };
            };
            const progress = parsed.progress;
            if (progress) {
              const pct = typeof progress.passRate === "number" ? `${(progress.passRate * 100).toFixed(1)}%` : "unknown";
              const passCount = typeof progress.passCount === "number" ? progress.passCount : -1;
              const totalTests = typeof progress.totalTests === "number" ? progress.totalTests : -1;
              appendOrchestrationLedgerFromRuntime(
                input.sessionID,
                "oracle_progress_snapshot",
                "behavioral_runtime",
                progress.improved ? 0.85 : 0.6,
                `Oracle progress snapshot: passRate=${pct} pass=${passCount}/${totalTests} improved=${progress.improved === true}`,
                "tool.execute.after"
              );
            }
          } catch {
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
        const earlyDecoy = earlyFlagDecoyStage({
          flagDetectorEnabled: config.flag_detector.enabled,
          raw,
          tool: input.tool,
          state: store.get(input.sessionID),
        });
        if (earlyDecoy.setDecoySuspect) {
          store.update(input.sessionID, {
            decoySuspect: true,
            decoySuspectReason: earlyDecoy.setDecoySuspect.reason,
          });
          store.applyEvent(input.sessionID, "decoy_suspect");
          appendOrchestrationLedgerFromRuntime(
            input.sessionID,
            "decoy_suspect",
            "string_pattern",
            0.75,
            `Early decoy suspect: ${earlyDecoy.setDecoySuspect.reason}`,
            "tool.execute.after"
          );
        }
        if (earlyDecoy.setEarlyCandidate && earlyDecoy.setEarlyCandidate.candidate) {
          store.applyEvent(input.sessionID, "candidate_found");
          store.setCandidate(input.sessionID, earlyDecoy.setEarlyCandidate.candidate);
        }
        metricSignals.push(...earlyDecoy.metricSignals);
        if (earlyDecoy.toastMessage) {
          await maybeShowToast({
            sessionID: input.sessionID,
            key: "decoy_early",
            title: "oh-my-Aegis: decoy suspect",
            message: earlyDecoy.toastMessage,
            variant: "warning",
          });
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

          if (shouldTrackLoopDebt) {
            const last5 = stuckState.toolCallHistory.slice(-5);
            if (last5.length === 5 && new Set(last5).size === 1 && last5[0] !== stuckState.lastToolPattern) {
              store.update(input.sessionID, {
                staleToolPatternLoops: stuckState.staleToolPatternLoops + 1,
                lastToolPattern: last5[0],
              });
              metricSignals.push(`stuck:stale_pattern:${last5[0]}`);
            }
          }
        }

        if (verificationRelevant) {
          const verifyOutcome = classifyVerificationStage({
            raw,
            state: stateBeforeVerifyCheck,
          });
          let verifyFailDecoyReason = "";
          if (verifyOutcome?.kind === "verify_fail") {
            if (stateBeforeVerifyCheck.mode === "CTF" && extractVerifierEvidence(raw, stateBeforeVerifyCheck.latestCandidate)) {
              const summary = raw.replace(/\s+/g, " ").trim().slice(0, 240);
              const failedRoute = stateBeforeVerifyCheck.lastTaskCategory || route(stateBeforeVerifyCheck, config).primary;
              store.recordFailure(input.sessionID, "static_dynamic_contradiction", failedRoute, summary);
            }
            store.applyEvent(input.sessionID, "verify_fail");
            if (verifyOutcome.contradictionDetected) {
              store.applyEvent(input.sessionID, "static_dynamic_contradiction");
              const stForSLA = store.get(input.sessionID);
              const slaLoops = stForSLA.contradictionSLALoops + 1;
              store.update(input.sessionID, {
                contradictionSLALoops: slaLoops,
                contradictionSLADumpRequired: slaLoops >= 1 && !stForSLA.contradictionPatchDumpDone,
              });
            }
            const verifyFailDecoy = classifyVerifyFailDecoyStage({
              raw,
              state: store.get(input.sessionID),
            });
            if (verifyFailDecoy) {
              verifyFailDecoyReason = verifyFailDecoy.decoyReason;
              store.update(input.sessionID, {
                decoySuspect: true,
                decoySuspectReason: verifyFailDecoy.decoyReason,
              });
              store.applyEvent(input.sessionID, "decoy_suspect");
              metricSignals.push("decoy_suspect");
            }
            const ledgerIntents = buildEvidenceLedgerIntentsStage({
              verifyOutcome,
              verifyFailDecoyReason,
              oracleProgressSummary: "",
              oracleProgressConfidence: 0,
            });
            for (const intent of ledgerIntents) {
              if (intent.orchestrationOnly) {
                appendOrchestrationLedgerFromRuntime(
                  input.sessionID,
                  intent.event,
                  intent.evidenceType,
                  intent.confidence,
                  intent.summary,
                  "tool.execute.after"
                );
              } else {
                appendLedgerFromRuntime(
                  input.sessionID,
                  intent.event,
                  intent.evidenceType,
                  intent.confidence,
                  verifyOutcome.normalizedSummary,
                  "tool.execute.after"
                );
              }
            }
            metricSignals.push(...verifyOutcome.metricSignals);
            await maybeShowToast({
              sessionID: input.sessionID,
              key: verifyOutcome.toast.key,
              title: verifyOutcome.toast.title,
              message: verifyOutcome.toast.message,
              variant: verifyOutcome.toast.variant,
            });
          } else if (verifyOutcome?.kind === "verify_success") {
            store.setCandidate(input.sessionID, verifyOutcome.verifierEvidence);
            store.applyEvent(input.sessionID, "verify_success");
            Object.assign(metricExtras, verifyOutcome.metricExtras);
            const ledgerIntents = buildEvidenceLedgerIntentsStage({
              verifyOutcome,
              verifyFailDecoyReason: "",
              oracleProgressSummary: "",
              oracleProgressConfidence: 0,
            });
            for (const intent of ledgerIntents) {
              appendLedgerFromRuntime(
                input.sessionID,
                intent.event,
                intent.evidenceType,
                intent.confidence,
                intent.summary,
                "tool.execute.after"
              );
            }
            if (verifyOutcome.acceptanceOk) {
              store.setVerified(input.sessionID, verifyOutcome.verifierEvidence);
              store.setAcceptanceEvidence(input.sessionID, verifyOutcome.normalizedSummary);
              store.applyEvent(input.sessionID, "submit_accepted");
            }
            metricSignals.push(...verifyOutcome.metricSignals);
            await maybeShowToast({
              sessionID: input.sessionID,
              key: verifyOutcome.toast.key,
              title: verifyOutcome.toast.title,
              message: verifyOutcome.toast.message,
              variant: verifyOutcome.toast.variant,
            });
          } else if (verifyOutcome?.kind === "verify_blocked") {
            metricSignals.push(...verifyOutcome.metricSignals);
            Object.assign(metricExtras, verifyOutcome.metricExtras);
            store.setFailureDetails(
              input.sessionID,
              verifyOutcome.failureReason,
              stateBeforeVerifyCheck.lastTaskCategory || route(stateBeforeVerifyCheck, config).primary,
              verifyOutcome.taggedSummary
            );
            store.applyEvent(input.sessionID, "verify_fail");
            const ledgerIntents = buildEvidenceLedgerIntentsStage({
              verifyOutcome,
              verifyFailDecoyReason: "",
              oracleProgressSummary: "",
              oracleProgressConfidence: 0,
            });
            for (const intent of ledgerIntents) {
              appendLedgerFromRuntime(
                input.sessionID,
                intent.event,
                intent.evidenceType,
                intent.confidence,
                intent.summary,
                "tool.execute.after"
              );
            }
            if (verifyOutcome.contradictionDetected) {
              store.applyEvent(input.sessionID, "static_dynamic_contradiction");
              if (!verifyOutcome.envEvidenceOk) {
                store.applyEvent(input.sessionID, "readonly_inconclusive");
              }
            }
            await maybeShowToast({
              sessionID: input.sessionID,
              key: verifyOutcome.toast.key,
              title: verifyOutcome.toast.title,
              message: verifyOutcome.toast.message,
              variant: verifyOutcome.toast.variant,
            });
          }

        }

        if (parsedOracleProgress) {
          const oracleProgressStage = evaluateOracleProgressStage({
            parsedOracleProgress,
            state: store.get(input.sessionID),
            now: Date.now(),
          });
          if (oracleProgressStage.changed) {
            store.update(input.sessionID, oracleProgressStage.nextState);
            store.applyEvent(input.sessionID, "oracle_progress");
            const ledgerIntents = buildEvidenceLedgerIntentsStage({
              verifyOutcome: null,
              verifyFailDecoyReason: "",
              oracleProgressSummary: oracleProgressStage.ledgerSummary,
              oracleProgressConfidence: oracleProgressStage.confidence,
            });
            for (const intent of ledgerIntents) {
              appendOrchestrationLedgerFromRuntime(
                input.sessionID,
                intent.event,
                intent.evidenceType,
                intent.confidence,
                intent.summary,
                "tool.execute.after"
              );
            }
            metricSignals.push(...oracleProgressStage.metricSignals);
            Object.assign(metricExtras, oracleProgressStage.metricExtras);
          }
        }

        const classifiedFailureStage = classifyFailureForMetricsStage({
          classifiedFailure: classifiedFailureSafe,
          raw,
          failedRoute: (() => {
            const stateForFailure = store.get(input.sessionID);
            return stateForFailure.lastTaskCategory || route(stateForFailure, config).primary;
          })(),
        });
        if (classifiedFailureStage.shouldSetFailureDetails) {
          if (classifiedFailureStage.setFailureReason === "hypothesis_stall") {
            if (shouldTrackLoopDebt) {
              store.setFailureDetails(
                input.sessionID,
                classifiedFailureStage.setFailureReason,
                classifiedFailureStage.failedRoute,
                classifiedFailureStage.summary
              );
              if (classifiedFailureStage.event === "same_payload_repeat") {
                store.applyEvent(input.sessionID, "same_payload_repeat");
              } else if (classifiedFailureStage.event === "no_new_evidence") {
                store.applyEvent(input.sessionID, "no_new_evidence");
              }
            }
          } else if (classifiedFailureStage.setFailureReason !== "none") {
            store.recordFailure(
              input.sessionID,
              classifiedFailureStage.setFailureReason,
              classifiedFailureStage.failedRoute,
              classifiedFailureStage.summary
            );
          }
          if (classifiedFailureStage.metricSignal && (shouldTrackLoopDebt || classifiedFailureStage.setFailureReason !== "hypothesis_stall")) {
            metricSignals.push(classifiedFailureStage.metricSignal);
          }
        }

        if (input.tool === "task") {
          const state = store.get(input.sessionID);
          const modelHealthStage = classifyTaskOutcomeAndModelHealthStage({
            tool: input.tool,
            raw,
            state,
            classifiedFailure: classifiedFailureSafe,
            config,
            agentModel,
          });
          if (modelHealthStage.shouldRecordOutcome) {
            store.recordDispatchOutcome(input.sessionID, modelHealthStage.outcome);
          }
          if (modelHealthStage.modelToMarkUnhealthy) {
            const lastSubagent = state.lastTaskSubagent;
            store.markModelUnhealthy(input.sessionID, modelHealthStage.modelToMarkUnhealthy, modelHealthStage.reason);
            safeNoteWrite("model.unhealthy", () => {
              notesStore.recordScan(
                `Model marked unhealthy: ${modelHealthStage.modelToMarkUnhealthy} (via ${lastSubagent}). Dynamic failover will route to alternative model.`
              );
            });
          }

          const failoverStage = shapeTaskFailoverAutoloopStage({
            state,
            isRetryableFailure: modelHealthStage.outcome === "retryable_failure",
            useModelFailover: modelHealthStage.useModelFailover,
            maxFailoverRetries: config.auto_dispatch.max_failover_retries,
            classifiedFailure: classifiedFailureSafe,
          });

          if (failoverStage.armFailover) {
            store.triggerTaskFailover(input.sessionID);
            await maybeShowToast({
              sessionID: input.sessionID,
              key: "task_failover_armed",
              title: "oh-my-Aegis: failover armed",
              message: failoverStage.failoverToastMessage,
              variant: "warning",
            });
            safeNoteWrite("task.failover", () => {
              notesStore.recordScan(failoverStage.failoverNoteMessage);
            });
          } else if (failoverStage.clearFailover) {
            store.clearTaskFailover(input.sessionID);
          }

          if (failoverStage.disableAutoloop) {
            store.setAutoLoopEnabled(input.sessionID, false);
            metricSignals.push(...failoverStage.metricSignals);
            safeNoteWrite("autoloop.stop", () => {
              notesStore.recordScan(failoverStage.autoloopNoteMessage);
            });
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
            const skipManagerReadAugmentation = callerAgent === "aegis";
            if (!skipManagerReadAugmentation && config.context_injection.enabled) {
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

            if (!skipManagerReadAugmentation && config.rules_injector.enabled) {
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
          const flagged = classifyFlagDetectorStage({
            enabled: true,
            outputText,
            tool: input.tool,
          });
          if (flagged && flagged.flags.length > 0) {
            safeNoteWrite("flag-detector", () => {
              notesStore.recordScan(
                `Flag candidate detected in ${input.tool} output: ${flagged.flags.join(", ")}\n${flagged.alert}`
              );
            });
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

      // Issue 2: available sub-agents from config routing
      const modeRouting = state.mode === "CTF" ? config.routing.ctf : config.routing.bounty;
      const subagentSet = new Set<string>();
      for (const phaseMap of Object.values(modeRouting)) {
        for (const routeName of Object.values(phaseMap as Record<string, string>)) {
          if (typeof routeName === "string" && routeName) {
            subagentSet.add(routeName);
          }
        }
      }
      const availableSubagents = [...subagentSet].sort();

      const systemLines: string[] = [
        `MODE: ${state.mode}`,
        `PHASE: ${state.phase}`,
        `TARGET: ${state.targetType}`,
        `ULTRAWORK: ${state.ultraworkEnabled ? "ENABLED" : "DISABLED"}`,
        "",
        // Issue 10: route transparency
        buildRouteTransparencySection(state, decision.primary, decision.reason),
        "",
        // Issue 1: Intent Gate (Phase 0)
        buildIntentGateSection(state),
        "",
      ];

      // Issue 6: Problem state
      const problemStateSection = buildProblemStateSection(state);
      if (problemStateSection) {
        systemLines.push(problemStateSection, "");
      }

      systemLines.push(buildPhaseInstruction(state), "");

      const signalGuidance = buildSignalGuidance(state, config);
      if (signalGuidance.length > 0) {
        systemLines.push(...signalGuidance, "");
      }

      systemLines.push(buildToolGuide(state), "");

      // Issue 2: dynamic available sub-agents
      const subagentsSection = buildAvailableSubagentsSection(state, availableSubagents);
      if (subagentsSection) {
        systemLines.push(subagentsSection, "");
      }

      // Issue 3: delegation bias
      systemLines.push(buildDelegateBiasSection(state), "");

      // Issue 5: parallel rules
      systemLines.push(buildParallelRulesSection(state), "");

      const playbook = buildTaskPlaybook(state, config);
      if (playbook) {
        systemLines.push(playbook, "");
      }

      // Issue 7: hard blocks
      systemLines.push(buildHardBlocksSection(), "");

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
