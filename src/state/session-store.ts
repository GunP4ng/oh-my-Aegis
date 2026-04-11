import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { z } from "zod";
import { atomicWriteFileSync } from "../io/atomic-write";
import { DebouncedSyncFlusher } from "./debounced-sync-flusher";
import { applySessionEvent, CONTRADICTION_PATCH_LOOP_BUDGET } from "./session-event-reducer";
import {
  DEFAULT_STATE,
  type AegisTodoEntry,
  type DispatchOutcomeType,
  type FailureReason,
  type IntentType,
  type Mode,
  type ProblemStateClass,
  type SessionEvent,
  type SessionState,
  type SharedChannelMessage,
  type SubagentProfileOverride,
  type SubagentDispatchHealth,
  type TargetType,
  type ThinkMode,
} from "./types";

export const RECENT_EVENTS_LIMIT = 30;
const DISPATCH_HEALTH_PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

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
  | "stage_todo_runtime"
  | "commit_todo_runtime"
  | "clear_loop_guard"
  | "publish_shared_message"
  | "set_solve_lane"
  | "manual_verify_success"
  | "set_intent"
  | "set_problem_state"
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
  input_validation_non_retryable: z.number().int().nonnegative().optional().default(0),
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

const AegisTodoEntrySchema = z.object({
  id: z.string().default(""),
  content: z.string().default(""),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).default("pending"),
  priority: z.string().default("medium"),
  resolution: z.enum(["none", "success", "failed", "blocked"]).default("none"),
});

const StagedTodoMutationSchema = z.object({
  toolCallID: z.string().min(1),
  todos: z.array(AegisTodoEntrySchema).default([]),
  createdAt: z.number().int().nonnegative().default(0),
});

const TodoRuntimeStateSchema = z.object({
  version: z.number().int().nonnegative().default(0),
  canonical: z.array(AegisTodoEntrySchema).default([]),
  staged: StagedTodoMutationSchema.nullable().default(null),
});

const LoopGuardStateSchema = z.object({
  recentActionSignatures: z.array(z.string()).default([]),
  blockedActionSignature: z.string().default(""),
  blockedReason: z.string().default(""),
  blockedAt: z.number().int().nonnegative().default(0),
});

const SharedChannelMessageSchema = z.object({
  seq: z.number().int().nonnegative().default(0),
  id: z.string().default(""),
  from: z.string().default(""),
  to: z.string().default(""),
  kind: z.string().default("note"),
  summary: z.string().default(""),
  refs: z.array(z.string()).default([]),
  at: z.number().int().nonnegative().default(0),
});

const SharedChannelStateSchema = z.object({
  seq: z.number().int().nonnegative().default(0),
  messages: z.array(SharedChannelMessageSchema).default([]),
});

const ProviderFamilySchema = z.enum(["openai", "google", "anthropic", "xai", "meta", "unknown"]);
const ReviewVerdictSchema = z.enum(["pending", "approved", "rejected"]);

const GovernancePatchMetadataSchema = z.object({
  proposalRefs: z.array(z.string().min(1).max(512)).max(20).default([]),
  digest: z.string().max(128).default(""),
  authorProviderFamily: ProviderFamilySchema.default("unknown"),
  reviewerProviderFamily: ProviderFamilySchema.default("unknown"),
});

const GovernanceReviewMetadataSchema = z.object({
  verdict: ReviewVerdictSchema.default("pending"),
  digest: z.string().max(128).default(""),
  reviewedAt: z.number().int().nonnegative().default(0),
});

const GovernanceCouncilMetadataSchema = z.object({
  decisionArtifactRef: z.string().max(512).default(""),
  decidedAt: z.number().int().nonnegative().default(0),
});

const GovernanceApplyLockMetadataSchema = z.object({
  lockID: z.string().max(128).default(""),
  ownerSessionID: z.string().max(128).default(""),
  ownerProviderFamily: ProviderFamilySchema.default("unknown"),
  ownerSubagent: z.string().max(128).default(""),
  acquiredAt: z.number().int().nonnegative().default(0),
});

const GovernanceMetadataSchema = z
  .object({
    patch: GovernancePatchMetadataSchema.default(DEFAULT_STATE.governance.patch),
    review: GovernanceReviewMetadataSchema.default(DEFAULT_STATE.governance.review),
    council: GovernanceCouncilMetadataSchema.default(DEFAULT_STATE.governance.council),
    applyLock: GovernanceApplyLockMetadataSchema.default(DEFAULT_STATE.governance.applyLock),
  })
  .default(DEFAULT_STATE.governance)
  .catch(DEFAULT_STATE.governance);

const SessionStateSchema = z.object({
  mode: z.enum(["CTF", "BOUNTY"]),
  modeExplicit: z.boolean().default(false),
  ultraworkEnabled: z.boolean().default(false),
  thinkMode: z.enum(["none", "think", "ultrathink"]).default("none"),
  autoLoopEnabled: z.boolean().default(false),
  autoLoopIterations: z.number().int().nonnegative().default(0),
  autoLoopStartedAt: z.number().int().nonnegative().default(0),
  autoLoopLastPromptAt: z.number().int().nonnegative().default(0),
  phase: z.enum(["SCAN", "PLAN", "EXECUTE", "VERIFY", "SUBMIT", "CLOSED"]),
  targetType: z.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"]),
  scopeConfirmed: z.boolean(),
  candidatePendingVerification: z.boolean(),
  latestCandidate: z.string(),
  latestVerified: z.string(),
  latestAcceptanceEvidence: z.string().default(""),
  candidateLevel: z.enum(["L0", "L1", "L2", "L3"]).default("L0"),
  governance: GovernanceMetadataSchema,
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
  lastCandidateHash: z.string().default(""),
  intentType: z.enum(["research", "implement", "investigate", "evaluate", "fix", "unknown"]).default("unknown"),
  problemStateClass: z.enum(["clean", "deceptive", "environment_sensitive", "evidence_poor", "unknown"]).default("unknown"),
  activeSolveLane: z.string().nullable().default(null),
  activeSolveLaneSetAt: z.number().int().nonnegative().default(0),
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
  oracleProgressUpdatedAt: z.number().int().nonnegative().default(0),
  oracleProgressImprovedAt: z.number().int().nonnegative().default(0),
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
  lastTaskCallerAgent: z.string().default("").catch(""),
  lastTaskSubagent: z.string().default(""),
  lastTaskModel: z.string().default(""),
  lastTaskVariant: z.string().default(""),
  blockedEpochId: z.string().default("").catch(""),
  blockedEpochActive: z.boolean().default(false).catch(false),
  blockedEpochEscalationLevel: z.number().int().nonnegative().default(0).catch(0),
  blockedEpochStartedAt: z.number().int().nonnegative().default(0).catch(0),
  blockedEpochLastProgressAt: z.number().int().nonnegative().default(0).catch(0),
  blockedEpochSummaryIssued: z.boolean().default(false).catch(false),
  blockedEpochReason: z.string().default("").catch(""),
  orchestrationHopStreak: z.number().int().nonnegative().default(0).catch(0),
  pendingTaskFailover: z.boolean(),
  taskFailoverCount: z.number().int().nonnegative(),
  dispatchHealthBySubagent: z.record(z.string(), SubagentDispatchHealthSchema).default({}),
  subagentProfileOverrides: z.record(z.string(), SubagentProfileOverrideSchema).default({}),
  modelHealthByModel: z.record(z.string(), ModelHealthEntrySchema).default({}),
  todoRuntime: TodoRuntimeStateSchema.default(DEFAULT_STATE.todoRuntime),
  loopGuard: LoopGuardStateSchema.default(DEFAULT_STATE.loopGuard),
  sharedChannels: z.record(z.string(), SharedChannelStateSchema).default({}),
  lastFailureReason: z.enum([
    "none",
    "verification_mismatch",
    "tooling_timeout",
    "context_overflow",
    "input_validation_non_retryable",
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
const SessionStoreEnvelopeSchema = z.object({
  schemaVersion: z.literal(2),
  sessions: SessionMapSchema,
});
const SessionStoreSchemaVersionSchema = z.object({
  schemaVersion: z.number(),
});
function cloneGovernanceMetadata(source: SessionState["governance"]): SessionState["governance"] {
  return {
    patch: {
      ...source.patch,
      proposalRefs: [...source.patch.proposalRefs],
    },
    review: { ...source.review },
    council: { ...source.council },
    applyLock: { ...source.applyLock },
  };
}

function cloneTodoEntries(source: AegisTodoEntry[]): AegisTodoEntry[] {
  return source.map((todo) => ({ ...todo }));
}

function cloneSharedChannelMessage(message: SharedChannelMessage): SharedChannelMessage {
  return {
    ...message,
    refs: [...message.refs],
  };
}

export class SessionStore {
  private readonly filePath: string;
  private readonly stateMap = new Map<string, SessionState>();
  private readonly observer?: StoreObserver;
  private readonly defaultMode: Mode;
  private readonly asyncPersistence: boolean;
  private readonly onPersist?: (metric: SessionStorePersistMetric) => void;
  private persistenceDegraded = false;
  private observerDegraded = false;
  private persistenceBlockedByFutureSchema = false;
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
      governance: cloneGovernanceMetadata(DEFAULT_STATE.governance),
      failureReasonCounts: { ...DEFAULT_STATE.failureReasonCounts },
      lastTaskCallerAgent: DEFAULT_STATE.lastTaskCallerAgent,
      lastTaskModel: "",
      lastTaskVariant: "",
      blockedEpochId: DEFAULT_STATE.blockedEpochId,
      blockedEpochActive: DEFAULT_STATE.blockedEpochActive,
      blockedEpochEscalationLevel: DEFAULT_STATE.blockedEpochEscalationLevel,
      blockedEpochStartedAt: DEFAULT_STATE.blockedEpochStartedAt,
      blockedEpochLastProgressAt: DEFAULT_STATE.blockedEpochLastProgressAt,
      blockedEpochSummaryIssued: DEFAULT_STATE.blockedEpochSummaryIssued,
      blockedEpochReason: DEFAULT_STATE.blockedEpochReason,
      orchestrationHopStreak: DEFAULT_STATE.orchestrationHopStreak,
      dispatchHealthBySubagent: {},
      subagentProfileOverrides: {},
      modelHealthByModel: {},
      todoRuntime: {
        version: DEFAULT_STATE.todoRuntime.version,
        canonical: cloneTodoEntries(DEFAULT_STATE.todoRuntime.canonical),
        staged: DEFAULT_STATE.todoRuntime.staged,
      },
      loopGuard: {
        recentActionSignatures: [...DEFAULT_STATE.loopGuard.recentActionSignatures],
        blockedActionSignature: DEFAULT_STATE.loopGuard.blockedActionSignature,
        blockedReason: DEFAULT_STATE.loopGuard.blockedReason,
        blockedAt: DEFAULT_STATE.loopGuard.blockedAt,
      },
      sharedChannels: {},
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
    if (state.phase === "CLOSED") {
      return state;
    }
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
    const rank: Record<SessionState["candidateLevel"], number> = {
      L0: 0,
      L1: 1,
      L2: 2,
      L3: 3,
    };
    if (rank[level] >= rank[state.candidateLevel]) {
      state.candidateLevel = level;
    }
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
    variant = "",
    callerAgent = ""
  ): SessionState {
    const state = this.get(sessionID);
    state.lastTaskRoute = routeName;
    state.lastTaskCallerAgent = callerAgent.trim();
    state.lastTaskSubagent = subagentType;
    state.lastTaskModel = model.trim();
    state.lastTaskVariant = variant.trim();

    const normalizedRoute = routeName.trim().toLowerCase();
    if (normalizedRoute === "md-scribe") {
      state.mdScribePrimaryStreak += 1;
    } else {
      state.mdScribePrimaryStreak = 0;
    }

    if (state.contradictionPivotDebt > 0 && !state.contradictionPatchDumpDone) {
      state.contradictionPivotDebt = Math.max(0, state.contradictionPivotDebt - 1);
    }

    const NON_SOLVE_ROUTES = new Set([
      "md-scribe",
      "bounty-scope",
      "aegis-plan--governance-review-required",
      "aegis-plan--governance-council-required",
      "aegis-exec--governance-apply-ready",
    ]);
    if (normalizedRoute && !NON_SOLVE_ROUTES.has(normalizedRoute)) {
      state.activeSolveLane = routeName;
      state.activeSolveLaneSetAt = Date.now();
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

    const pruneThreshold = Date.now() - DISPATCH_HEALTH_PRUNE_AFTER_MS;
    for (const [key, entry] of Object.entries(state.dispatchHealthBySubagent)) {
      if (entry.lastOutcomeAt > 0 && entry.lastOutcomeAt < pruneThreshold) {
        delete state.dispatchHealthBySubagent[key];
      }
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

  stageTodoRuntime(sessionID: string, toolCallID: string, todos: AegisTodoEntry[]): SessionState {
    const state = this.get(sessionID);
    state.todoRuntime.staged = {
      toolCallID,
      todos: cloneTodoEntries(todos),
      createdAt: Date.now(),
    };
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "stage_todo_runtime");
    return state;
  }

  commitTodoRuntime(sessionID: string, toolCallID: string, todos?: AegisTodoEntry[]): SessionState {
    const state = this.get(sessionID);
    const staged = state.todoRuntime.staged;
    if (!staged || staged.toolCallID !== toolCallID) {
      return state;
    }
    const nextTodos = Array.isArray(todos) ? cloneTodoEntries(todos) : cloneTodoEntries(staged.todos);
    state.todoRuntime.canonical = nextTodos;
    state.todoRuntime.version += 1;
    state.todoRuntime.staged = null;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "commit_todo_runtime");
    return state;
  }

  recordActionSignature(sessionID: string, signature: string, limit = 12): SessionState {
    const state = this.get(sessionID);
    const normalized = signature.trim();
    if (!normalized) {
      return state;
    }
    state.loopGuard.recentActionSignatures.push(normalized);
    if (state.loopGuard.recentActionSignatures.length > limit) {
      state.loopGuard.recentActionSignatures = state.loopGuard.recentActionSignatures.slice(-limit);
    }
    state.lastUpdatedAt = Date.now();
    this.persist();
    return state;
  }

  setLoopGuardBlock(sessionID: string, signature: string, reason: string): SessionState {
    const state = this.get(sessionID);
    state.loopGuard.blockedActionSignature = signature.trim();
    state.loopGuard.blockedReason = reason.trim();
    state.loopGuard.blockedAt = Date.now();
    state.lastUpdatedAt = Date.now();
    this.persist();
    return state;
  }

  clearLoopGuard(sessionID: string): SessionState {
    const state = this.get(sessionID);
    state.loopGuard.blockedActionSignature = "";
    state.loopGuard.blockedReason = "";
    state.loopGuard.blockedAt = 0;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "clear_loop_guard");
    return state;
  }

  publishSharedMessage(
    sessionID: string,
    channelID: string,
    message: Omit<SharedChannelMessage, "seq" | "at">
  ): SharedChannelMessage {
    const state = this.get(sessionID);
    const channelKey = channelID.trim() || "shared";
    const channel = state.sharedChannels[channelKey] ?? { seq: 0, messages: [] };
    channel.seq += 1;
    const nextMessage: SharedChannelMessage = {
      seq: channel.seq,
      at: Date.now(),
      id: message.id.trim(),
      from: message.from.trim(),
      to: message.to.trim(),
      kind: message.kind.trim(),
      summary: message.summary.trim(),
      refs: [...message.refs],
    };
    channel.messages.push(nextMessage);
    if (channel.messages.length > 100) {
      channel.messages = channel.messages.slice(-100);
    }
    state.sharedChannels[channelKey] = channel;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "publish_shared_message");
    return cloneSharedChannelMessage(nextMessage);
  }

  readSharedMessages(sessionID: string, channelID = "shared", sinceSeq = 0, limit = 20): SharedChannelMessage[] {
    const state = this.get(sessionID);
    const channel = state.sharedChannels[channelID.trim() || "shared"];
    if (!channel) {
      return [];
    }
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    return channel.messages
      .filter((message) => message.seq > sinceSeq)
      .slice(-safeLimit)
      .map(cloneSharedChannelMessage);
  }

  applyEvent(sessionID: string, event: SessionEvent): SessionState {
    const state = this.get(sessionID);
    if (state.phase === "CLOSED") {
      return state;
    }
    state.recentEvents.push(event);
    if (state.recentEvents.length > RECENT_EVENTS_LIMIT) {
      state.recentEvents = state.recentEvents.slice(-RECENT_EVENTS_LIMIT);
    }
    applySessionEvent(state, event, {
      now: () => Date.now(),
      computeCandidateHash: (currentState) => this.computeCandidateHash(currentState),
    });
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, event);
    return state;
  }

  setSolveLane(sessionID: string, lane: string | null): SessionState {
    const state = this.get(sessionID);
    state.activeSolveLane = lane;
    state.activeSolveLaneSetAt = lane ? Date.now() : 0;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_solve_lane");
    return state;
  }

  setIntent(sessionID: string, intentType: IntentType): SessionState {
    const state = this.get(sessionID);
    state.intentType = intentType;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_intent");
    return state;
  }

  setProblemStateClass(sessionID: string, cls: ProblemStateClass): SessionState {
    const state = this.get(sessionID);
    state.problemStateClass = cls;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_problem_state");
    return state;
  }

  setManualVerifySuccess(
    sessionID: string,
    evidence: {
      verificationCommand: string;
      stdoutSummary: string;
      artifactPath?: string;
    }
  ): SessionState {
    if (!evidence.verificationCommand || !evidence.stdoutSummary) {
      throw new Error("manual verify_success requires verificationCommand and stdoutSummary");
    }
    const state = this.get(sessionID);
    state.latestAcceptanceEvidence = JSON.stringify(evidence);
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "manual_verify_success");
    return this.applyEvent(sessionID, "verify_success");
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

  private computeCandidateHash(state: SessionState): string {
    const raw = [
      state.latestCandidate,
      state.latestAcceptanceEvidence,
      ...state.contradictionArtifacts,
    ].join("|");
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const decoded = JSON.parse(raw);

      const versionProbe = SessionStoreSchemaVersionSchema.safeParse(decoded);
      if (versionProbe.success && versionProbe.data.schemaVersion > 2) {
        this.persistenceBlockedByFutureSchema = true;
        console.warn(
          `[session-store] Unsupported orchestrator state schema version ${versionProbe.data.schemaVersion}; using empty in-memory state and preserving on-disk file.`
        );
        return;
      }

      let sessions: Record<string, SessionState> | null = null;
      const v2Parsed = SessionStoreEnvelopeSchema.safeParse(decoded);
      if (v2Parsed.success) {
        sessions = v2Parsed.data.sessions;
      } else if (!versionProbe.success) {
        const v1Parsed = SessionMapSchema.safeParse(decoded);
        if (!v1Parsed.success) {
          return;
        }
        sessions = v1Parsed.data;
      } else {
        return;
      }

      for (const [sessionID, state] of Object.entries(sessions)) {
        const hydrated: SessionState = {
          ...DEFAULT_STATE,
          ...state,
          alternatives: [...state.alternatives],
          recentEvents: [...state.recentEvents],
          contradictionArtifacts: [...state.contradictionArtifacts],
          replayLowTrustBinaries: [...state.replayLowTrustBinaries],
          toolCallHistory: [...state.toolCallHistory],
          governance: cloneGovernanceMetadata(state.governance),
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
    if (this.persistenceBlockedByFutureSchema) {
      return;
    }
    this.persistFlusher.request();
  }

  private persistSync(): { ok: boolean; payloadBytes: number; reason: string } {
    const payload =
      JSON.stringify({
        schemaVersion: 2,
        sessions: this.toJSON(),
      }) + "\n";
    const payloadBytes = Buffer.byteLength(payload, "utf-8");
    const dir = dirname(this.filePath);
    try {
      mkdirSync(dir, { recursive: true });
      atomicWriteFileSync(this.filePath, payload);
      this.persistenceDegraded = false;
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
      this.observerDegraded = false;
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
