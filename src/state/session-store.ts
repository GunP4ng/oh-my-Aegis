import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { atomicWriteFileSync } from "../io/atomic-write";
import { DebouncedSyncFlusher } from "./debounced-sync-flusher";
import {
  DEFAULT_STATE,
  type DispatchOutcomeType,
  type FailureReason,
  type Mode,
  type SessionEvent,
  type SessionState,
  type SubagentProfileOverride,
  type SubagentDispatchHealth,
  type TargetType,
  type ThinkMode,
} from "./types";

export type StoreChangeReason =
  | "set_mode"
  | "set_ultrawork_enabled"
  | "set_think_mode"
  | "set_auto_loop_enabled"
  | "record_auto_loop_prompt"
  | "set_target_type"
  | "set_hypothesis"
  | "set_alternatives"
  | "set_env_parity"
  | "set_env_parity_required"
  | "set_rev_risk"
  | "set_candidate"
  | "set_verified"
  | "set_acceptance_evidence"
  | "set_candidate_level"
  | "record_failure"
  | "set_failure_details"
  | "clear_failure"
  | "set_last_task_category"
  | "set_last_dispatch"
  | "record_contradiction_artifacts"
  | "record_dispatch_outcome"
  | "set_subagent_profile_override"
  | "clear_subagent_profile_override"
  | "trigger_task_failover"
  | "consume_task_failover"
  | "clear_task_failover"
  | "mark_model_unhealthy"
  | "mark_model_healthy"
  | SessionEvent;

export interface StoreChangeEvent {
  sessionID: string;
  state: SessionState;
  reason: StoreChangeReason;
}

export interface SessionStorePersistMetric {
  trigger: "immediate" | "timer" | "manual";
  durationMs: number;
  stateCount: number;
  payloadBytes: number;
  asyncPersistence: boolean;
  failed: boolean;
  reason: string;
}

export interface SessionStoreOptions {
  asyncPersistence?: boolean;
  flushDelayMs?: number;
  onPersist?: (metric: SessionStorePersistMetric) => void;
}

export type StoreObserver = (event: StoreChangeEvent) => void;

const FailureReasonCountsSchema = z.object({
  none: z.number().int().nonnegative(),
  verification_mismatch: z.number().int().nonnegative(),
  tooling_timeout: z.number().int().nonnegative(),
  context_overflow: z.number().int().nonnegative(),
  hypothesis_stall: z.number().int().nonnegative(),
  unsat_claim: z.number().int().nonnegative(),
  static_dynamic_contradiction: z.number().int().nonnegative(),
  exploit_chain: z.number().int().nonnegative(),
  environment: z.number().int().nonnegative(),
});

const ModelHealthEntrySchema = z.object({
  unhealthySince: z.number().int().nonnegative().default(0),
  reason: z.string().default(""),
});

const SubagentDispatchHealthSchema = z.object({
  successCount: z.number().int().nonnegative().default(0),
  retryableFailureCount: z.number().int().nonnegative().default(0),
  hardFailureCount: z.number().int().nonnegative().default(0),
  consecutiveFailureCount: z.number().int().nonnegative().default(0),
  lastOutcomeAt: z.number().int().nonnegative().default(0),
});

const SubagentProfileOverrideSchema = z.object({
  model: z.string().min(1),
  variant: z.string().min(1),
});

const SessionStateSchema = z.object({
  mode: z.enum(["CTF", "BOUNTY"]),
  modeExplicit: z.boolean().default(false),
  ultraworkEnabled: z.boolean().default(false),
  thinkMode: z.enum(["none", "think", "ultrathink"]).default("none"),
  autoLoopEnabled: z.boolean().default(false),
  autoLoopIterations: z.number().int().nonnegative().default(0),
  autoLoopStartedAt: z.number().int().nonnegative().default(0),
  autoLoopLastPromptAt: z.number().int().nonnegative().default(0),
  phase: z.enum(["SCAN", "PLAN", "EXECUTE", "VERIFY", "SUBMIT"]),
  targetType: z.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"]),
  scopeConfirmed: z.boolean(),
  candidatePendingVerification: z.boolean(),
  latestCandidate: z.string(),
  latestVerified: z.string(),
  latestAcceptanceEvidence: z.string().default(""),
  candidateLevel: z.enum(["L0", "L1", "L2", "L3"]).default("L0"),
  submissionPending: z.boolean().default(false),
  submissionAccepted: z.boolean().default(false),
  hypothesis: z.string(),
  alternatives: z.array(z.string()),
  noNewEvidenceLoops: z.number().int().nonnegative(),
  samePayloadLoops: z.number().int().nonnegative(),
  staleToolPatternLoops: z.number().int().nonnegative().default(0),
  lastToolPattern: z.string().default(""),
  contradictionPivotDebt: z.number().int().nonnegative().default(0),
  contradictionPatchDumpDone: z.boolean().default(false),
  contradictionArtifactLockActive: z.boolean().default(false),
  contradictionArtifacts: z.array(z.string()).default([]),
  mdScribePrimaryStreak: z.number().int().nonnegative().default(0),
  verifyFailCount: z.number().int().nonnegative(),
  readonlyInconclusiveCount: z.number().int().nonnegative(),
  contextFailCount: z.number().int().nonnegative(),
  timeoutFailCount: z.number().int().nonnegative(),
  envParityChecked: z.boolean().default(false),
  envParityAllMatch: z.boolean().default(false),
  envParityRequired: z.boolean().default(false),
  envParityRequirementReason: z.string().default(""),
  envParitySummary: z.string().default(""),
  envParityUpdatedAt: z.number().int().nonnegative().default(0),
  revVmSuspected: z.boolean().default(false),
  revLoaderVmDetected: z.boolean().default(false),
  revRiskScore: z.number().nonnegative().default(0),
  revRiskSignals: z.array(z.string()).default([]),
  revStaticTrust: z.number().min(0).max(1).default(1),
  decoySuspect: z.boolean().default(false),
  decoySuspectReason: z.string().default(""),
  oraclePassCount: z.number().int().nonnegative().default(0),
  oracleFailIndex: z.number().int().default(-1),
  oracleTotalTests: z.number().int().nonnegative().default(0),
  contradictionSLALoops: z.number().int().nonnegative().default(0),
  contradictionSLADumpRequired: z.boolean().default(false),
  unsatCrossValidationCount: z.number().int().nonnegative().default(0),
  unsatUnhookedOracleRun: z.boolean().default(false),
  unsatArtifactDigestVerified: z.boolean().default(false),
  replayLowTrustBinaries: z.array(z.string()).default([]),
  toolCallCount: z.number().int().nonnegative().default(0),
  aegisToolCallCount: z.number().int().nonnegative().default(0),
  lastToolCallAt: z.number().int().nonnegative().default(0),
  toolCallHistory: z.array(z.string()).default([]),
  recentEvents: z.array(z.string()),
  lastTaskCategory: z.string(),
  lastTaskRoute: z.string().default(""),
  lastTaskSubagent: z.string().default(""),
  lastTaskModel: z.string().default(""),
  lastTaskVariant: z.string().default(""),
  pendingTaskFailover: z.boolean(),
  taskFailoverCount: z.number().int().nonnegative(),
  dispatchHealthBySubagent: z.record(z.string(), SubagentDispatchHealthSchema).default({}),
  subagentProfileOverrides: z.record(z.string(), SubagentProfileOverrideSchema).default({}),
  modelHealthByModel: z.record(z.string(), ModelHealthEntrySchema).default({}),
  lastFailureReason: z.enum([
    "none",
    "verification_mismatch",
    "tooling_timeout",
    "context_overflow",
    "hypothesis_stall",
    "unsat_claim",
    "static_dynamic_contradiction",
    "exploit_chain",
    "environment",
  ]),
  lastFailureSummary: z.string(),
  lastFailedRoute: z.string(),
  lastFailureAt: z.number().int().nonnegative(),
  failureReasonCounts: FailureReasonCountsSchema,
  lastUpdatedAt: z.number().int().nonnegative(),
});

const SessionMapSchema = z.record(z.string(), SessionStateSchema);
const CONTRADICTION_PATCH_LOOP_BUDGET = 2;

export class SessionStore {
  private readonly filePath: string;
  private readonly stateMap = new Map<string, SessionState>();
  private readonly observer?: StoreObserver;
  private readonly defaultMode: Mode;
  private readonly asyncPersistence: boolean;
  private readonly onPersist?: (metric: SessionStorePersistMetric) => void;
  private persistenceDegraded = false;
  private observerDegraded = false;
  private readonly persistFlusher: DebouncedSyncFlusher<
    { ok: boolean; payloadBytes: number; reason: string },
    SessionStorePersistMetric
  >;

  constructor(
    baseDirectory: string,
    observer?: StoreObserver,
    defaultMode: Mode = DEFAULT_STATE.mode,
    stateRootDir: string = ".Aegis",
    options: SessionStoreOptions = {}
  ) {
    this.filePath = join(baseDirectory, stateRootDir, "orchestrator_state.json");
    this.observer = observer;
    this.defaultMode = defaultMode;
    this.asyncPersistence = options.asyncPersistence === true;
    const flushDelayMs =
      typeof options.flushDelayMs === "number" && Number.isFinite(options.flushDelayMs)
        ? Math.max(0, Math.floor(options.flushDelayMs))
        : 30;
    this.onPersist = options.onPersist;
    this.persistFlusher = new DebouncedSyncFlusher({
      enabled: this.asyncPersistence,
      delayMs: flushDelayMs,
      isBlocked: () => this.persistenceDegraded,
      runSync: () => this.persistSync(),
      buildMetric: ({ trigger, durationMs, result }) => ({
        trigger,
        durationMs,
        stateCount: this.stateMap.size,
        payloadBytes: result.payloadBytes,
        asyncPersistence: this.asyncPersistence,
        failed: !result.ok,
        reason: result.reason,
      }),
      onMetric: this.onPersist,
    });
    this.load();
  }

  flushNow(): void {
    this.persistFlusher.flushNow();
  }

  get(sessionID: string): SessionState {
    const existing = this.stateMap.get(sessionID);
    if (existing) {
      return existing;
    }
    const fresh: SessionState = {
      ...DEFAULT_STATE,
      mode: this.defaultMode,
      alternatives: [...DEFAULT_STATE.alternatives],
      recentEvents: [...DEFAULT_STATE.recentEvents],
      contradictionArtifacts: [...DEFAULT_STATE.contradictionArtifacts],
      replayLowTrustBinaries: [...DEFAULT_STATE.replayLowTrustBinaries],
      toolCallHistory: [...DEFAULT_STATE.toolCallHistory],
      failureReasonCounts: { ...DEFAULT_STATE.failureReasonCounts },
      lastTaskModel: "",
      lastTaskVariant: "",
      dispatchHealthBySubagent: {},
      subagentProfileOverrides: {},
      modelHealthByModel: {},
      lastUpdatedAt: Date.now(),
    };
    this.stateMap.set(sessionID, fresh);
    return fresh;
  }

  update(sessionID: string, partial: Partial<SessionState>): SessionState {
    const state = this.get(sessionID);
    Object.assign(state, partial, { lastUpdatedAt: Date.now() });
    this.persist();
    return state;
  }

  setMode(sessionID: string, mode: Mode): SessionState {
    const state = this.get(sessionID);
    state.mode = mode;
    state.modeExplicit = true;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_mode");
    return state;
  }

  setUltraworkEnabled(sessionID: string, enabled: boolean): SessionState {
    const state = this.get(sessionID);
    state.ultraworkEnabled = enabled;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_ultrawork_enabled");
    return state;
  }

  setThinkMode(sessionID: string, mode: ThinkMode): SessionState {
    const state = this.get(sessionID);
    state.thinkMode = mode;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_think_mode");
    return state;
  }

  setAutoLoopEnabled(sessionID: string, enabled: boolean): SessionState {
    const state = this.get(sessionID);
    state.autoLoopEnabled = enabled;
    if (!enabled) {
      state.autoLoopIterations = 0;
      state.autoLoopStartedAt = 0;
      state.autoLoopLastPromptAt = 0;
    }
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_auto_loop_enabled");
    return state;
  }

  recordAutoLoopPrompt(sessionID: string): SessionState {
    const state = this.get(sessionID);
    const now = Date.now();
    if (state.autoLoopStartedAt <= 0) {
      state.autoLoopStartedAt = now;
    }
    state.autoLoopIterations += 1;
    state.autoLoopLastPromptAt = now;
    state.lastUpdatedAt = now;
    this.persist();
    this.notify(sessionID, state, "record_auto_loop_prompt");
    return state;
  }

  setTargetType(sessionID: string, targetType: TargetType): SessionState {
    const state = this.get(sessionID);
    state.targetType = targetType;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_target_type");
    return state;
  }

  setHypothesis(sessionID: string, hypothesis: string): SessionState {
    const state = this.get(sessionID);
    state.hypothesis = hypothesis;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_hypothesis");
    return state;
  }

  setAlternatives(sessionID: string, alternatives: string[]): SessionState {
    const state = this.get(sessionID);
    state.alternatives = alternatives.map((item) => item.trim()).filter((item) => item.length > 0);
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_alternatives");
    return state;
  }

  setEnvParity(sessionID: string, allMatch: boolean, summary = ""): SessionState {
    const state = this.get(sessionID);
    state.envParityChecked = true;
    state.envParityAllMatch = allMatch;
    state.envParitySummary = summary.trim();
    state.envParityUpdatedAt = Date.now();
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_env_parity");
    return state;
  }

  setEnvParityRequired(sessionID: string, required: boolean, reason = ""): SessionState {
    const state = this.get(sessionID);
    state.envParityRequired = required;
    state.envParityRequirementReason = reason.trim();
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_env_parity_required");
    return state;
  }

  setRevRisk(
    sessionID: string,
    risk: {
      vmSuspected: boolean;
      score: number;
      signals: string[];
      staticTrust: number;
    },
  ): SessionState {
    const state = this.get(sessionID);
    state.revVmSuspected = risk.vmSuspected;
    state.revRiskScore = risk.score;
    state.revRiskSignals = [...risk.signals];
    state.revStaticTrust = risk.staticTrust;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_rev_risk");
    return state;
  }

  setCandidate(sessionID: string, candidate: string): SessionState {
    const state = this.get(sessionID);
    state.latestCandidate = candidate;
    state.candidatePendingVerification = candidate.trim().length > 0;
    state.submissionPending = false;
    state.submissionAccepted = false;
    state.latestAcceptanceEvidence = "";
    if (state.candidatePendingVerification) {
      state.candidateLevel = "L1";
      if (state.phase === "EXECUTE" || state.phase === "PLAN") {
        state.phase = "VERIFY";
      }
    }
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_candidate");
    return state;
  }

  setVerified(sessionID: string, verified: string): SessionState {
    const state = this.get(sessionID);
    state.latestVerified = verified;
    if (verified.trim().length > 0) {
      state.candidateLevel = "L3";
      state.submissionAccepted = true;
      state.submissionPending = false;
      state.phase = "SUBMIT";
    }
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_verified");
    return state;
  }

  setAcceptanceEvidence(sessionID: string, evidence: string): SessionState {
    const state = this.get(sessionID);
    state.latestAcceptanceEvidence = evidence.trim();
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_acceptance_evidence");
    return state;
  }

  setCandidateLevel(sessionID: string, level: SessionState["candidateLevel"]): SessionState {
    const state = this.get(sessionID);
    state.candidateLevel = level;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_candidate_level");
    return state;
  }

  recordFailure(sessionID: string, reason: FailureReason, routeName = "", summary = ""): SessionState {
    const state = this.get(sessionID);
    state.lastFailureReason = reason;
    state.lastFailedRoute = routeName;
    state.lastFailureSummary = summary;
    state.lastFailureAt = Date.now();
    state.failureReasonCounts[reason] += 1;
    if (reason === "static_dynamic_contradiction") {
      state.contradictionArtifactLockActive = true;
      state.contradictionPatchDumpDone = false;
      if (state.contradictionPivotDebt <= 0) {
        state.contradictionPivotDebt = CONTRADICTION_PATCH_LOOP_BUDGET;
      }
      state.contradictionArtifacts = [];
    }
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "record_failure");
    return state;
  }

  setFailureDetails(sessionID: string, reason: FailureReason, routeName = "", summary = ""): SessionState {
    const state = this.get(sessionID);
    state.lastFailureReason = reason;
    state.lastFailedRoute = routeName;
    state.lastFailureSummary = summary;
    state.lastFailureAt = Date.now();
    if (reason === "static_dynamic_contradiction") {
      state.contradictionArtifactLockActive = true;
      state.contradictionPatchDumpDone = false;
      if (state.contradictionPivotDebt <= 0) {
        state.contradictionPivotDebt = CONTRADICTION_PATCH_LOOP_BUDGET;
      }
      state.contradictionArtifacts = [];
    }
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_failure_details");
    return state;
  }

  clearFailure(sessionID: string): SessionState {
    const state = this.get(sessionID);
    state.lastFailureReason = "none";
    state.lastFailedRoute = "";
    state.lastFailureSummary = "";
    state.lastFailureAt = 0;
    state.contradictionArtifactLockActive = false;
    state.contradictionPatchDumpDone = false;
    state.contradictionPivotDebt = 0;
    state.contradictionArtifacts = [];
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "clear_failure");
    return state;
  }

  setLastTaskCategory(sessionID: string, category: string): SessionState {
    const state = this.get(sessionID);
    state.lastTaskCategory = category;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_last_task_category");
    return state;
  }

  setLastDispatch(
    sessionID: string,
    routeName: string,
    subagentType: string,
    model = "",
    variant = ""
  ): SessionState {
    const state = this.get(sessionID);
    state.lastTaskRoute = routeName;
    state.lastTaskSubagent = subagentType;
    state.lastTaskModel = model.trim();
    state.lastTaskVariant = variant.trim();

    const normalizedRoute = routeName.trim().toLowerCase();
    if (normalizedRoute === "md-scribe") {
      state.mdScribePrimaryStreak += 1;
    } else {
      state.mdScribePrimaryStreak = 0;
    }

    const pattern = subagentType.trim() || routeName.trim();
    if (!pattern) {
      state.lastToolPattern = "";
      state.staleToolPatternLoops = 0;
    } else if (state.lastToolPattern === pattern) {
      state.staleToolPatternLoops += 1;
    } else {
      state.lastToolPattern = pattern;
      state.staleToolPatternLoops = 1;
    }

    if (state.contradictionPivotDebt > 0 && !state.contradictionPatchDumpDone) {
      state.contradictionPivotDebt = Math.max(0, state.contradictionPivotDebt - 1);
    }

    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_last_dispatch");
    return state;
  }

  recordContradictionArtifacts(sessionID: string, artifacts: string[]): SessionState {
    const state = this.get(sessionID);
    const normalized = artifacts
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 20);
    if (normalized.length === 0) {
      return state;
    }

    const merged = [...state.contradictionArtifacts, ...normalized];
    state.contradictionArtifacts = [...new Set(merged)].slice(-20);
    state.contradictionPatchDumpDone = true;
    state.contradictionArtifactLockActive = false;
    state.contradictionPivotDebt = 0;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "record_contradiction_artifacts");
    return state;
  }

  recordDispatchOutcome(sessionID: string, outcome: DispatchOutcomeType): SessionState {
    const state = this.get(sessionID);
    const subagentType = state.lastTaskSubagent.trim();
    if (!subagentType) {
      return state;
    }

    const health = this.getOrCreateDispatchHealth(state, subagentType);
    health.lastOutcomeAt = Date.now();
    if (outcome === "success") {
      health.successCount += 1;
      health.consecutiveFailureCount = 0;
    } else if (outcome === "retryable_failure") {
      health.retryableFailureCount += 1;
      health.consecutiveFailureCount += 1;
    } else {
      health.hardFailureCount += 1;
      health.consecutiveFailureCount += 1;
    }

    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "record_dispatch_outcome");
    return state;
  }

  setSubagentProfileOverride(
    sessionID: string,
    subagentType: string,
    profile: SubagentProfileOverride
  ): SessionState {
    const state = this.get(sessionID);
    const key = subagentType.trim();
    const model = profile.model.trim();
    const variant = profile.variant.trim();
    if (!key || !model) {
      return state;
    }
    state.subagentProfileOverrides[key] = {
      model,
      variant,
    };
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_subagent_profile_override");
    return state;
  }

  clearSubagentProfileOverride(sessionID: string, subagentType?: string): SessionState {
    const state = this.get(sessionID);
    const key = typeof subagentType === "string" ? subagentType.trim() : "";
    if (key) {
      delete state.subagentProfileOverrides[key];
    } else {
      state.subagentProfileOverrides = {};
    }
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "clear_subagent_profile_override");
    return state;
  }

  triggerTaskFailover(sessionID: string): SessionState {
    const state = this.get(sessionID);
    state.pendingTaskFailover = true;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "trigger_task_failover");
    return state;
  }

  consumeTaskFailover(sessionID: string): SessionState {
    const state = this.get(sessionID);
    state.pendingTaskFailover = false;
    state.taskFailoverCount += 1;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "consume_task_failover");
    return state;
  }

  clearTaskFailover(sessionID: string): SessionState {
    const state = this.get(sessionID);
    state.pendingTaskFailover = false;
    state.taskFailoverCount = 0;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "clear_task_failover");
    return state;
  }

  applyEvent(sessionID: string, event: SessionEvent): SessionState {
    const state = this.get(sessionID);
    state.recentEvents.push(event);
    if (state.recentEvents.length > 30) {
      state.recentEvents = state.recentEvents.slice(-30);
    }
    switch (event) {
      case "scan_completed":
        state.phase = "PLAN";
        break;
      case "plan_completed":
        state.phase = state.candidatePendingVerification ? "VERIFY" : "EXECUTE";
        break;
      case "candidate_found":
        state.candidatePendingVerification = true;
        state.candidateLevel = "L1";
        state.submissionPending = false;
        state.submissionAccepted = false;
        state.latestAcceptanceEvidence = "";
        if (state.phase === "PLAN" || state.phase === "EXECUTE") {
          state.phase = "VERIFY";
        }
        state.contextFailCount = Math.max(0, state.contextFailCount - 1);
        state.timeoutFailCount = Math.max(0, state.timeoutFailCount - 1);
        break;
      case "verify_success":
        state.candidatePendingVerification = false;
        state.candidateLevel = "L2";
        state.phase = "SUBMIT";
        state.submissionPending = true;
        state.submissionAccepted = false;
        state.lastFailureReason = "none";
        state.lastFailureSummary = "";
        state.lastFailedRoute = "";
        state.lastFailureAt = 0;
        state.verifyFailCount = 0;
        state.noNewEvidenceLoops = 0;
        state.samePayloadLoops = 0;
        state.staleToolPatternLoops = 0;
        state.lastToolPattern = "";
        state.contradictionPivotDebt = 0;
        state.contradictionPatchDumpDone = false;
        state.contradictionArtifactLockActive = false;
        state.contradictionArtifacts = [];
        break;
      case "verify_fail":
        state.candidatePendingVerification = false;
        state.phase = "EXECUTE";
        state.submissionPending = false;
        state.submissionAccepted = false;
        state.latestAcceptanceEvidence = "";
        state.candidateLevel = state.latestCandidate.trim().length > 0 ? "L1" : "L0";
        state.verifyFailCount += 1;
        state.noNewEvidenceLoops += 1;
        state.lastFailureReason = "verification_mismatch";
        state.failureReasonCounts.verification_mismatch += 1;
        state.lastFailureAt = Date.now();
        break;
      case "submit_accepted":
        state.phase = "SUBMIT";
        state.submissionPending = false;
        state.submissionAccepted = true;
        state.candidateLevel = "L3";
        if (!state.latestVerified && state.latestCandidate) {
          state.latestVerified = state.latestCandidate;
        }
        state.lastFailureReason = "none";
        state.lastFailureSummary = "";
        state.lastFailedRoute = "";
        state.lastFailureAt = 0;
        state.verifyFailCount = 0;
        state.noNewEvidenceLoops = 0;
        state.samePayloadLoops = 0;
        state.staleToolPatternLoops = 0;
        state.lastToolPattern = "";
        state.contradictionPivotDebt = 0;
        state.contradictionPatchDumpDone = false;
        state.contradictionArtifactLockActive = false;
        state.contradictionArtifacts = [];
        state.mdScribePrimaryStreak = 0;
        state.pendingTaskFailover = false;
        state.taskFailoverCount = 0;
        break;
      case "submit_rejected":
        state.phase = "EXECUTE";
        state.submissionPending = false;
        state.submissionAccepted = false;
        state.candidateLevel = state.latestCandidate.trim().length > 0 ? "L1" : "L0";
        state.verifyFailCount += 1;
        state.lastFailureReason = "verification_mismatch";
        state.failureReasonCounts.verification_mismatch += 1;
        state.lastFailureAt = Date.now();
        break;
      case "no_new_evidence":
        state.noNewEvidenceLoops += 1;
        state.lastFailureReason = "hypothesis_stall";
        state.failureReasonCounts.hypothesis_stall += 1;
        state.lastFailureAt = Date.now();
        break;
      case "same_payload_repeat":
        state.samePayloadLoops += 1;
        state.lastFailureReason = "hypothesis_stall";
        state.failureReasonCounts.hypothesis_stall += 1;
        state.lastFailureAt = Date.now();
        break;
      case "new_evidence":
        if (state.phase === "VERIFY" || state.phase === "SUBMIT") {
          state.phase = "EXECUTE";
        }
        state.noNewEvidenceLoops = 0;
        state.samePayloadLoops = 0;
        state.staleToolPatternLoops = 0;
        state.lastToolPattern = "";
        state.contradictionPivotDebt = 0;
        state.contradictionPatchDumpDone = false;
        state.contradictionArtifactLockActive = false;
        state.contradictionArtifacts = [];
        state.submissionPending = false;
        state.submissionAccepted = false;
        state.latestAcceptanceEvidence = "";
        state.candidateLevel = state.latestCandidate.trim().length > 0 ? "L1" : "L0";
        state.pendingTaskFailover = false;
        state.taskFailoverCount = 0;
        state.lastFailureReason = "none";
        state.lastFailureSummary = "";
        state.lastFailedRoute = "";
        state.lastFailureAt = 0;
        state.contextFailCount = Math.max(0, state.contextFailCount - 1);
        state.timeoutFailCount = Math.max(0, state.timeoutFailCount - 1);
        break;
      case "readonly_inconclusive":
        state.readonlyInconclusiveCount += 1;
        break;
      case "scope_confirmed":
        state.scopeConfirmed = true;
        break;
      case "context_length_exceeded":
        state.contextFailCount += 1;
        state.lastFailureReason = "context_overflow";
        state.failureReasonCounts.context_overflow += 1;
        state.lastFailureAt = Date.now();
        break;
      case "timeout":
        state.timeoutFailCount += 1;
        state.lastFailureReason = "tooling_timeout";
        state.failureReasonCounts.tooling_timeout += 1;
        state.lastFailureAt = Date.now();
        break;
      case "unsat_claim":
        state.lastFailureReason = "unsat_claim";
        state.failureReasonCounts.unsat_claim += 1;
        state.lastFailureAt = Date.now();
        break;
      case "static_dynamic_contradiction":
        state.lastFailureReason = "static_dynamic_contradiction";
        state.failureReasonCounts.static_dynamic_contradiction += 1;
        state.lastFailureAt = Date.now();
        state.contradictionPivotDebt = CONTRADICTION_PATCH_LOOP_BUDGET;
        state.contradictionPatchDumpDone = false;
        state.contradictionArtifactLockActive = true;
        state.contradictionArtifacts = [];
        break;
      case "reset_loop":
        state.phase = "SCAN";
        state.noNewEvidenceLoops = 0;
        state.samePayloadLoops = 0;
        state.staleToolPatternLoops = 0;
        state.lastToolPattern = "";
        state.contradictionPivotDebt = 0;
        state.contradictionPatchDumpDone = false;
        state.contradictionArtifactLockActive = false;
        state.contradictionArtifacts = [];
        state.candidateLevel = state.latestVerified.trim().length > 0 ? "L3" : "L0";
        state.submissionPending = false;
        state.submissionAccepted = state.latestVerified.trim().length > 0;
        state.latestAcceptanceEvidence = "";
        state.mdScribePrimaryStreak = 0;
        state.readonlyInconclusiveCount = 0;
        state.lastFailureReason = "none";
        state.lastFailureSummary = "";
        state.lastFailedRoute = "";
        state.lastFailureAt = 0;
        break;
    }
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, event);
    return state;
  }

  markModelUnhealthy(sessionID: string, modelId: string, reason: string): SessionState {
    const state = this.get(sessionID);
    state.modelHealthByModel[modelId] = {
      unhealthySince: Date.now(),
      reason,
    };
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "mark_model_unhealthy");
    return state;
  }

  markModelHealthy(sessionID: string, modelId: string): SessionState {
    const state = this.get(sessionID);
    delete state.modelHealthByModel[modelId];
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "mark_model_healthy");
    return state;
  }

  toJSON(): Record<string, SessionState> {
    const obj: Record<string, SessionState> = {};
    for (const [key, value] of this.stateMap.entries()) {
      obj[key] = value;
    }
    return obj;
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = SessionMapSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return;
      }
      for (const [sessionID, state] of Object.entries(parsed.data)) {
        const hydrated: SessionState = {
          ...DEFAULT_STATE,
          ...state,
          alternatives: [...state.alternatives],
          recentEvents: [...state.recentEvents],
          failureReasonCounts: { ...state.failureReasonCounts },
          dispatchHealthBySubagent: { ...state.dispatchHealthBySubagent },
          subagentProfileOverrides: { ...state.subagentProfileOverrides },
          modelHealthByModel: { ...state.modelHealthByModel },
        };
        if (
          !hydrated.contradictionArtifactLockActive &&
          hydrated.contradictionPivotDebt > 0 &&
          !hydrated.contradictionPatchDumpDone
        ) {
          hydrated.contradictionArtifactLockActive = true;
        }
        this.stateMap.set(sessionID, hydrated);
      }
    } catch {
      // Keep default empty state map when persistence is malformed.
    }
  }

  private persist(): void {
    this.persistFlusher.request();
  }

  private persistSync(): { ok: boolean; payloadBytes: number; reason: string } {
    const payload = JSON.stringify(this.toJSON()) + "\n";
    const payloadBytes = Buffer.byteLength(payload, "utf-8");
    const dir = dirname(this.filePath);
    try {
      mkdirSync(dir, { recursive: true });
      atomicWriteFileSync(this.filePath, payload);
      return { ok: true, payloadBytes, reason: "" };
    } catch {
      this.persistenceDegraded = true;
      return { ok: false, payloadBytes, reason: "persist_failed" };
    }
  }

  private notify(sessionID: string, state: SessionState, reason: StoreChangeReason): void {
    if (!this.observer || this.observerDegraded) {
      return;
    }
    try {
      this.observer({
        sessionID,
        state: { ...state },
        reason,
      });
    } catch {
      this.observerDegraded = true;
    }
  }

  private getOrCreateDispatchHealth(
    state: SessionState,
    subagentType: string
  ): SubagentDispatchHealth {
    const existing = state.dispatchHealthBySubagent[subagentType];
    if (existing) {
      return existing;
    }

    const fresh: SubagentDispatchHealth = {
      successCount: 0,
      retryableFailureCount: 0,
      hardFailureCount: 0,
      consecutiveFailureCount: 0,
      lastOutcomeAt: 0,
    };
    state.dispatchHealthBySubagent[subagentType] = fresh;
    return fresh;
  }
}
