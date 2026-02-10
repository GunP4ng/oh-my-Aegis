import type { OrchestratorConfig } from "../config/schema";
import { DEFAULT_ROUTING } from "../config/schema";
import type { SessionState } from "../state/types";

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

export function isStuck(state: SessionState): boolean {
  return (
    state.noNewEvidenceLoops >= 2 ||
    state.samePayloadLoops >= 2 ||
    state.verifyFailCount >= 2
  );
}

function modeRouting(state: SessionState, config?: OrchestratorConfig) {
  const routing = config?.routing ?? DEFAULT_ROUTING;
  return state.mode === "CTF" ? routing.ctf : routing.bounty;
}

function failureDrivenRoute(state: SessionState, config?: OrchestratorConfig): RouteDecision | null {
  if (state.mode !== "CTF") {
    return null;
  }

  if (state.lastFailureReason === "context_overflow") {
    return {
      primary: "md-scribe",
      reason: "Recent failure indicates context overflow: compact state and retry with smaller context.",
      followups: [modeRouting(state, config).stuck[state.targetType]],
    };
  }

  if (state.lastFailureReason === "verification_mismatch" && state.phase === "EXECUTE") {
    return {
      primary: "ctf-decoy-check",
      reason: "Recent verification mismatch: run decoy-check before next verification attempt.",
      followups: ["ctf-verify"],
    };
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

  if (state.lastFailureReason === "hypothesis_stall" && isStuck(state)) {
    return {
      primary: modeRouting(state, config).stuck[state.targetType],
      reason: "Repeated no-evidence loop detected: force pivot via stuck route.",
    };
  }

  return null;
}

function isRiskyCtfCandidate(state: SessionState, config?: OrchestratorConfig): boolean {
  const fastVerify = config?.ctf_fast_verify;
  const riskyTargets = new Set(fastVerify?.risky_targets ?? ["WEB_API", "WEB3", "UNKNOWN"]);
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
  return false;
}

export function route(state: SessionState, config?: OrchestratorConfig): RouteDecision {
  const routing = modeRouting(state, config);

  if (state.contextFailCount >= 2 || state.timeoutFailCount >= 2) {
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

  if (isStuck(state)) {
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
    reason: "EXECUTE phase: one TODO only, then verify/log.",
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
