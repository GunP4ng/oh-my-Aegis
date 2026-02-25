import type { OrchestratorConfig } from "../config/schema";
import { DEFAULT_ROUTING } from "../config/schema";
import type { SessionState } from "../state/types";
import { isLowConfidenceCandidate } from "../risk/sanitize";

export interface RouteDecision {
  primary: string;
  reason: string;
  followups?: string[];
}

export interface FailoverConfig {
  signatures: string[];
  map: {
    explore: string;
    librarian: string;
    oracle: string;
  };
}

export function isStuck(state: SessionState, config?: OrchestratorConfig): boolean {
  const threshold = config?.stuck_threshold ?? 2;
  return (
    state.noNewEvidenceLoops >= threshold ||
    state.samePayloadLoops >= threshold ||
    state.verifyFailCount >= threshold
  );
}

function modeRouting(state: SessionState, config?: OrchestratorConfig) {
  const routing = config?.routing ?? DEFAULT_ROUTING;
  return state.mode === "CTF" ? routing.ctf : routing.bounty;
}

function contradictionPivotPrimary(state: SessionState, config?: OrchestratorConfig): string {
  const routing = modeRouting(state, config);
  if (state.mode === "CTF" && (state.targetType === "PWN" || state.targetType === "REV")) {
    return "ctf-rev";
  }
  return routing.scan[state.targetType];
}

function hasActiveContradictionArtifactLock(state: SessionState): boolean {
  return state.contradictionArtifactLockActive && !state.contradictionPatchDumpDone;
}

function hasObservationEvidence(state: SessionState): boolean {
  return (
    state.verifyFailCount > 0 ||
    state.noNewEvidenceLoops > 0 ||
    state.samePayloadLoops > 0 ||
    state.readonlyInconclusiveCount > 0 ||
    state.failureReasonCounts.verification_mismatch > 0 ||
    state.failureReasonCounts.hypothesis_stall > 0 ||
    state.failureReasonCounts.static_dynamic_contradiction > 0
  );
}

function routeForContextOverflowFailure(state: SessionState, config?: OrchestratorConfig): RouteDecision {
  const routing = modeRouting(state, config);
  if (state.phase === "EXECUTE") {
    return {
      primary: routing.stuck[state.targetType],
      reason:
        "EXECUTE context overflow: keep solving route primary and use md-scribe as followup for compaction.",
      followups: ["md-scribe"],
    };
  }
  if (state.mdScribePrimaryStreak >= 2) {
    return {
      primary: routing.stuck[state.targetType],
      reason:
        "md-scribe guard: repeated context compaction route reached limit, pivot to target-aware stuck route.",
    };
  }
  return {
    primary: "md-scribe",
    reason: "Recent failure indicates context overflow: compact state and retry with smaller context.",
    followups: [routing.stuck[state.targetType]],
  };
}

function routeForVerificationMismatchFailure(state: SessionState, config?: OrchestratorConfig): RouteDecision {
  const routing = modeRouting(state, config);
  if (isStuck(state, config)) {
    return {
      primary: routing.stuck[state.targetType],
      reason:
        "Repeated verification mismatches suggest a decoy or wrong constraints: stop re-verifying and pivot via stuck route.",
    };
  }
  if (state.mode !== "CTF") {
    return {
      primary: "bounty-triage",
      reason: "Recent verification mismatch in BOUNTY: re-run minimal-impact reproducible triage before escalation.",
    };
  }
  return {
    primary: "ctf-decoy-check",
    reason: "Recent verification mismatch: run decoy-check before next verification attempt.",
    followups: ["ctf-verify"],
  };
}

function routeForHypothesisStallFailure(state: SessionState, config?: OrchestratorConfig): RouteDecision {
  const routing = modeRouting(state, config);
  if (state.staleToolPatternLoops >= 3 && state.noNewEvidenceLoops > 0) {
    return {
      primary: state.mode === "CTF" ? "ctf-hypothesis" : routing.stuck[state.targetType],
      reason:
        "Stale hypothesis kill-switch: repeated same tool/subagent pattern without new evidence. Cancel current line and switch to extraction/transform hypothesis.",
      followups: [routing.stuck[state.targetType]],
    };
  }
  return {
    primary: routing.stuck[state.targetType],
    reason: "Repeated no-evidence loop detected: force pivot via stuck route.",
  };
}

function routeForStaticDynamicContradictionFailure(
  state: SessionState,
  config?: OrchestratorConfig
): RouteDecision {
  const routing = modeRouting(state, config);
  if (hasActiveContradictionArtifactLock(state)) {
    return {
      primary: contradictionPivotPrimary(state, config),
      reason:
        "Static/dynamic contradiction hard-trigger: extraction-first pivot is mandatory until artifact evidence is recorded.",
      followups: [routing.stuck[state.targetType]],
    };
  }
  return {
    primary: routing.stuck[state.targetType],
    reason: "Static/dynamic contradiction detected: force deep pivot via target stuck route.",
  };
}

function routeForUnsatFailure(state: SessionState, config?: OrchestratorConfig): RouteDecision {
  const routing = modeRouting(state, config);
  const alternativesCount = state.alternatives.filter((item) => item.trim().length > 0).length;
  const evidenceReady = hasObservationEvidence(state);

  if (state.mode !== "CTF") {
    if (alternativesCount < 2 || !evidenceReady) {
      return {
        primary: "bounty-triage",
        reason:
          "UNSAT gate (BOUNTY): blocked until at least 2 alternatives and reproducible observation evidence exist; continue minimal-impact triage.",
        followups: [routing.stuck[state.targetType]],
      };
    }
    return {
      primary: routing.stuck[state.targetType],
      reason: "UNSAT gate (BOUNTY) satisfied: alternatives/evidence present; escalate via target-aware stuck route.",
    };
  }

  if (alternativesCount < 2 || !evidenceReady) {
    return {
      primary: "ctf-hypothesis",
      reason:
        "UNSAT gate: blocked until at least 2 alternatives and internal observation evidence exist; continue hypothesis/disconfirm cycle.",
      followups: [routing.stuck[state.targetType]],
    };
  }

  return {
    primary: routing.stuck[state.targetType],
    reason: "UNSAT gate satisfied: alternatives/evidence present, pivot via stuck route for deep validation.",
  };
}


function failureDrivenRoute(state: SessionState, config?: OrchestratorConfig): RouteDecision | null {
  if (state.lastFailureReason === "context_overflow") {
    return routeForContextOverflowFailure(state, config);
  }

  if (state.lastFailureReason === "verification_mismatch" && state.phase === "EXECUTE") {
    return routeForVerificationMismatchFailure(state, config);
  }

  if (state.lastFailureReason === "tooling_timeout") {
    return {
      primary: modeRouting(state, config).failover[state.targetType],
      reason: "Recent failure indicates timeout/quota pressure: use failover route.",
    };
  }

  if (state.lastFailureReason === "exploit_chain") {
    return {
      primary: modeRouting(state, config).stuck[state.targetType],
      reason: "Recent exploit-chain failure: pivot with target-specific stuck strategy.",
    };
  }

  if (state.lastFailureReason === "hypothesis_stall" && isStuck(state, config)) {
    return routeForHypothesisStallFailure(state, config);
  }

  if (state.lastFailureReason === "static_dynamic_contradiction") {
    return routeForStaticDynamicContradictionFailure(state, config);
  }

  if (state.lastFailureReason === "unsat_claim") {
    return routeForUnsatFailure(state, config);
  }

  return null;
}

function isRiskyCtfCandidate(state: SessionState, config?: OrchestratorConfig): boolean {
  const fastVerify = config?.ctf_fast_verify;
  const riskyTargets = new Set(
    fastVerify?.risky_targets ?? ["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"]
  );
  const enforceAllTargets = fastVerify?.enforce_all_targets ?? true;
  if (enforceAllTargets) {
    riskyTargets.add("WEB_API");
    riskyTargets.add("WEB3");
    riskyTargets.add("PWN");
    riskyTargets.add("REV");
    riskyTargets.add("CRYPTO");
    riskyTargets.add("FORENSICS");
    riskyTargets.add("MISC");
    riskyTargets.add("UNKNOWN");
  }
  const requireNonemptyCandidate = fastVerify?.require_nonempty_candidate ?? true;

  if (riskyTargets.has(state.targetType)) {
    return true;
  }
  if (state.verifyFailCount > 0 || state.noNewEvidenceLoops > 0 || state.samePayloadLoops > 0) {
    return true;
  }
  if (requireNonemptyCandidate && state.latestCandidate.trim().length === 0) {
    return true;
  }
  if (isLowConfidenceCandidate(state.latestCandidate)) {
    return true;
  }
  return false;
}

export function route(state: SessionState, config?: OrchestratorConfig): RouteDecision {
  const routing = modeRouting(state, config);

  if (hasActiveContradictionArtifactLock(state) && !(state.mode === "BOUNTY" && !state.scopeConfirmed)) {
    if (state.contradictionPivotDebt > 0) {
      return {
        primary: contradictionPivotPrimary(state, config),
        reason: `Contradiction pivot active: run extraction-first pivot within ${state.contradictionPivotDebt} dispatch loops.`,
        followups: [routing.stuck[state.targetType]],
      };
    }
    return {
      primary: contradictionPivotPrimary(state, config),
      reason:
        "Contradiction artifact lock active: extraction-first pivot remains mandatory until artifact path evidence is recorded.",
      followups: [routing.stuck[state.targetType]],
    };
  }

  if (state.contextFailCount >= 2 || state.timeoutFailCount >= 2) {
    if (state.phase === "EXECUTE") {
      return {
        primary: routing.stuck[state.targetType],
        reason:
          "EXECUTE timeout/context debt detected: keep solving route primary and run md-scribe only as followup compaction.",
        followups: ["md-scribe"],
      };
    }
    if (state.mdScribePrimaryStreak >= 2) {
      return {
        primary: routing.stuck[state.targetType],
        reason:
          "md-scribe guard: consecutive logging route threshold reached, pivot to target-aware stuck route instead of repeating md-scribe.",
      };
    }
    return {
      primary: "md-scribe",
      reason: "Context/timeout failures exceeded threshold: compact and refresh durable notes before continuing.",
      followups: [routing.stuck[state.targetType]],
    };
  }

  if (state.mode === "BOUNTY" && !state.scopeConfirmed) {
    return {
      primary: "bounty-scope",
      reason: "BOUNTY mode requires scope confirmation before active validation.",
    };
  }

  const failureRoute = failureDrivenRoute(state, config);
  if (failureRoute) {
    return failureRoute;
  }

  if (state.candidatePendingVerification) {
    if (state.mode === "CTF") {
      if (state.lastFailureReason === "verification_mismatch") {
        return {
          primary: "ctf-decoy-check",
          reason: "Verification mismatch detected: run decoy-check before re-verify.",
          followups: ["ctf-verify"],
        };
      }
      const fastVerifyEnabled = config?.ctf_fast_verify?.enabled ?? true;
      if (fastVerifyEnabled && !isRiskyCtfCandidate(state, config)) {
        return {
          primary: "ctf-verify",
          reason: "Low-risk CTF candidate: run direct verification fast-path.",
        };
      }
      return {
        primary: "ctf-decoy-check",
        reason: "Candidate found: run decoy check before official verification.",
        followups: ["ctf-verify"],
      };
    }

    return {
      primary: "bounty-triage",
      reason: "Candidate in BOUNTY requires minimal-impact reproducible verification.",
    };
  }

  if (state.mode === "BOUNTY" && state.readonlyInconclusiveCount >= 2) {
    return {
      primary: "bounty-research",
      reason: "Two inconclusive read-only checks: escalate to safe CVE hypothesis research.",
    };
  }

  if (isStuck(state, config)) {
    return {
      primary: routing.stuck[state.targetType],
      reason: `Common stuck trigger: pivot using target-aware route '${routing.stuck[state.targetType]}'.`,
    };
  }

  if (state.phase === "SCAN") {
    return {
      primary: routing.scan[state.targetType],
      reason: `Start in SCAN phase with target-aware route '${routing.scan[state.targetType]}'.`,
    };
  }

  if (state.phase === "PLAN") {
    return {
      primary: routing.plan[state.targetType],
      reason: `PLAN phase: use '${routing.plan[state.targetType]}' for target-specific planning rigor.`,
      followups: [routing.execute[state.targetType]],
    };
  }

  return {
    primary: routing.execute[state.targetType],
    reason: "EXECUTE phase: follow plan-backed TODO list (one in_progress), then verify/log.",
    followups: state.mode === "CTF" ? ["ctf-verify"] : [],
  };
}

export function resolveFailoverAgent(
  originalAgent: string,
  errorText: string,
  config: FailoverConfig
): string | null {
  const lowered = errorText.toLowerCase();
  const matched = config.signatures.some((signature) => lowered.includes(signature.toLowerCase()));
  if (!matched) {
    return null;
  }

  if (originalAgent === "explore") return config.map.explore;
  if (originalAgent === "librarian") return config.map.librarian;
  if (originalAgent === "oracle") return config.map.oracle;
  return null;
}
