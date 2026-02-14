import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  DEFAULT_STATE,
  type DispatchOutcomeType,
  type FailureReason,
  type Mode,
  type SessionEvent,
  type SessionState,
  type SubagentDispatchHealth,
  type ModelHealthEntry,
  type TargetType,
} from "./types";

export type StoreChangeReason =
  | "set_mode"
  | "set_target_type"
  | "set_hypothesis"
  | "set_alternatives"
  | "set_candidate"
  | "set_verified"
  | "record_failure"
  | "clear_failure"
  | "set_last_task_category"
  | "set_last_dispatch"
  | "record_dispatch_outcome"
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

export type StoreObserver = (event: StoreChangeEvent) => void;

const FailureReasonCountsSchema = z.object({
  none: z.number().int().nonnegative(),
  verification_mismatch: z.number().int().nonnegative(),
  tooling_timeout: z.number().int().nonnegative(),
  context_overflow: z.number().int().nonnegative(),
  hypothesis_stall: z.number().int().nonnegative(),
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

const SessionStateSchema = z.object({
  mode: z.enum(["CTF", "BOUNTY"]),
  phase: z.enum(["SCAN", "PLAN", "EXECUTE"]),
  targetType: z.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"]),
  scopeConfirmed: z.boolean(),
  candidatePendingVerification: z.boolean(),
  latestCandidate: z.string(),
  latestVerified: z.string(),
  hypothesis: z.string(),
  alternatives: z.array(z.string()),
  noNewEvidenceLoops: z.number().int().nonnegative(),
  samePayloadLoops: z.number().int().nonnegative(),
  verifyFailCount: z.number().int().nonnegative(),
  readonlyInconclusiveCount: z.number().int().nonnegative(),
  contextFailCount: z.number().int().nonnegative(),
  timeoutFailCount: z.number().int().nonnegative(),
  recentEvents: z.array(z.string()),
  lastTaskCategory: z.string(),
  lastTaskRoute: z.string().default(""),
  lastTaskSubagent: z.string().default(""),
  pendingTaskFailover: z.boolean(),
  taskFailoverCount: z.number().int().nonnegative(),
  dispatchHealthBySubagent: z.record(z.string(), SubagentDispatchHealthSchema).default({}),
  modelHealthByModel: z.record(z.string(), ModelHealthEntrySchema).default({}),
  lastFailureReason: z.enum([
    "none",
    "verification_mismatch",
    "tooling_timeout",
    "context_overflow",
    "hypothesis_stall",
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

export class SessionStore {
  private readonly filePath: string;
  private readonly stateMap = new Map<string, SessionState>();
  private readonly observer?: StoreObserver;
  private readonly defaultMode: Mode;
  private persistenceDegraded = false;
  private observerDegraded = false;

  constructor(baseDirectory: string, observer?: StoreObserver, defaultMode: Mode = DEFAULT_STATE.mode) {
    this.filePath = join(baseDirectory, ".Aegis", "orchestrator_state.json");
    this.observer = observer;
    this.defaultMode = defaultMode;
    this.load();
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
      failureReasonCounts: { ...DEFAULT_STATE.failureReasonCounts },
      dispatchHealthBySubagent: {},
      modelHealthByModel: {},
      lastUpdatedAt: Date.now(),
    };
    this.stateMap.set(sessionID, fresh);
    return fresh;
  }

  setMode(sessionID: string, mode: Mode): SessionState {
    const state = this.get(sessionID);
    state.mode = mode;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_mode");
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

  setCandidate(sessionID: string, candidate: string): SessionState {
    const state = this.get(sessionID);
    state.latestCandidate = candidate;
    state.candidatePendingVerification = candidate.trim().length > 0;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_candidate");
    return state;
  }

  setVerified(sessionID: string, verified: string): SessionState {
    const state = this.get(sessionID);
    state.latestVerified = verified;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_verified");
    return state;
  }

  recordFailure(sessionID: string, reason: FailureReason, routeName = "", summary = ""): SessionState {
    const state = this.get(sessionID);
    state.lastFailureReason = reason;
    state.lastFailedRoute = routeName;
    state.lastFailureSummary = summary;
    state.lastFailureAt = Date.now();
    state.failureReasonCounts[reason] += 1;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "record_failure");
    return state;
  }

  clearFailure(sessionID: string): SessionState {
    const state = this.get(sessionID);
    state.lastFailureReason = "none";
    state.lastFailedRoute = "";
    state.lastFailureSummary = "";
    state.lastFailureAt = 0;
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

  setLastDispatch(sessionID: string, routeName: string, subagentType: string): SessionState {
    const state = this.get(sessionID);
    state.lastTaskRoute = routeName;
    state.lastTaskSubagent = subagentType;
    state.lastUpdatedAt = Date.now();
    this.persist();
    this.notify(sessionID, state, "set_last_dispatch");
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
        state.phase = "EXECUTE";
        break;
      case "candidate_found":
        state.candidatePendingVerification = true;
        break;
      case "verify_success":
        state.candidatePendingVerification = false;
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
        state.pendingTaskFailover = false;
        state.taskFailoverCount = 0;
        break;
      case "verify_fail":
        state.candidatePendingVerification = false;
        state.verifyFailCount += 1;
        state.noNewEvidenceLoops += 1;
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
        state.noNewEvidenceLoops = 0;
        state.samePayloadLoops = 0;
        state.pendingTaskFailover = false;
        state.taskFailoverCount = 0;
        state.lastFailureReason = "none";
        state.lastFailureSummary = "";
        state.lastFailedRoute = "";
        state.lastFailureAt = 0;
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
      case "reset_loop":
        state.noNewEvidenceLoops = 0;
        state.samePayloadLoops = 0;
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
        this.stateMap.set(sessionID, state);
      }
    } catch {
      // Keep default empty state map when persistence is malformed.
    }
  }

  private persist(): void {
    if (this.persistenceDegraded) {
      return;
    }
    const dir = dirname(this.filePath);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.toJSON(), null, 2) + "\n", "utf-8");
    } catch {
      this.persistenceDegraded = true;
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
