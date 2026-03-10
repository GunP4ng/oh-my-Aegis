import type { OrchestratorConfig } from "../config/schema";
import type { RouteDecision } from "../types/route-decision";
import type { SessionState } from "../state/types";

type RouteCounterSnapshot = {
  noNewEvidenceLoops: number;
  samePayloadLoops: number;
  verifyFailCount: number;
  staleToolPatternLoops: number;
  stuck: boolean;
};

const ROUTE_REASON_MAX_LEN = 240;
const ROUTE_TEXT_MAX_LEN = 80;
const ROUTE_FOLLOWUPS_MAX_COUNT = 4;
const STUCK_STALE_TOOL_PATTERN_THRESHOLD = 3;

function compactText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function createRouteLogger(deps: {
  getRootDirectory: () => string;
  isNotesReady: () => boolean;
  appendRecord: (record: Record<string, unknown>) => void;
  onError: (error: unknown) => void;
  isStuck: (state: SessionState, config: OrchestratorConfig) => boolean;
  config: OrchestratorConfig;
}) {
  const routeCounterSnapshots = new Map<string, RouteCounterSnapshot>();

  const appendOperationalRouteLog = (record: Record<string, unknown>): void => {
    if (!deps.isNotesReady()) {
      return;
    }
    try {
      deps.getRootDirectory();
      deps.appendRecord(record);
    } catch (error) {
      deps.onError(error);
    }
  };

  const logRouteDecision = (
    sessionID: string,
    state: SessionState,
    decision: RouteDecision,
    source: string,
  ): void => {
    if (!deps.isNotesReady()) {
      return;
    }

    const threshold = Math.max(1, Number(deps.config.stuck_threshold) || 2);
    const counters = {
      noNewEvidenceLoops: state.noNewEvidenceLoops,
      samePayloadLoops: state.samePayloadLoops,
      verifyFailCount: state.verifyFailCount,
      staleToolPatternLoops: state.staleToolPatternLoops,
    };
    const stuckNow = deps.isStuck(state, deps.config);
    const trippedCounters: string[] = [];
    if (counters.noNewEvidenceLoops >= threshold) trippedCounters.push("noNewEvidenceLoops");
    if (counters.samePayloadLoops >= threshold) trippedCounters.push("samePayloadLoops");
    if (counters.verifyFailCount >= threshold) trippedCounters.push("verifyFailCount");
    if (counters.staleToolPatternLoops >= STUCK_STALE_TOOL_PATTERN_THRESHOLD) {
      trippedCounters.push("staleToolPatternLoops");
    }

    const previous = routeCounterSnapshots.get(sessionID);
    const crossedCounters: string[] = [];
    if (!previous || previous.noNewEvidenceLoops < threshold) {
      if (counters.noNewEvidenceLoops >= threshold) crossedCounters.push("noNewEvidenceLoops");
    }
    if (!previous || previous.samePayloadLoops < threshold) {
      if (counters.samePayloadLoops >= threshold) crossedCounters.push("samePayloadLoops");
    }
    if (!previous || previous.verifyFailCount < threshold) {
      if (counters.verifyFailCount >= threshold) crossedCounters.push("verifyFailCount");
    }
    if (!previous || previous.staleToolPatternLoops < STUCK_STALE_TOOL_PATTERN_THRESHOLD) {
      if (counters.staleToolPatternLoops >= STUCK_STALE_TOOL_PATTERN_THRESHOLD) {
        crossedCounters.push("staleToolPatternLoops");
      }
    }

    const followups = (Array.isArray(decision.followups) ? decision.followups : [])
      .map((item) => compactText(item, ROUTE_TEXT_MAX_LEN))
      .filter((item) => item.length > 0)
      .slice(0, ROUTE_FOLLOWUPS_MAX_COUNT);
    const at = new Date().toISOString();

    appendOperationalRouteLog({
      kind: "RouteDecision",
      at,
      source,
      sessionID,
      primary: compactText(decision.primary, ROUTE_TEXT_MAX_LEN),
      followups,
      reason: compactText(decision.reason, ROUTE_REASON_MAX_LEN),
      phase: state.phase,
      targetType: state.targetType,
      counters,
      stuck: {
        value: stuckNow,
        threshold,
        staleToolPatternThreshold: STUCK_STALE_TOOL_PATTERN_THRESHOLD,
        trippedCounters,
      },
    });

    const stuckBecameTrue = previous ? !previous.stuck && stuckNow : stuckNow;
    if (stuckBecameTrue || crossedCounters.length > 0) {
      appendOperationalRouteLog({
        kind: "StuckTrigger",
        at,
        source,
        sessionID,
        primary: compactText(decision.primary, ROUTE_TEXT_MAX_LEN),
        phase: state.phase,
        targetType: state.targetType,
        stuckBecameTrue,
        crossedCounters,
        trippedCounters,
        counters,
      });
    }

    routeCounterSnapshots.set(sessionID, {
      noNewEvidenceLoops: counters.noNewEvidenceLoops,
      samePayloadLoops: counters.samePayloadLoops,
      verifyFailCount: counters.verifyFailCount,
      staleToolPatternLoops: counters.staleToolPatternLoops,
      stuck: stuckNow,
    });
  };

  return {
    logRouteDecision,
  };
}
