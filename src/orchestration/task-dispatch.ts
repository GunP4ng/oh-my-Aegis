import type { OrchestratorConfig } from "../config/schema";
import { baseAgentName, resolveHealthyAgent } from "./model-health";
import { DEFAULT_ROUTING } from "../config/schema";
import type { Mode, SessionState, TargetType } from "../state/types";

export interface TaskDispatchDecision {
  subagent_type?: string;
  reason: string;
}

export const NON_OVERRIDABLE_ROUTE_AGENTS = new Set([
  "ctf-verify",
  "ctf-decoy-check",
  "bounty-scope",
  "md-scribe",
]);

export function isNonOverridableSubagent(name: string): boolean {
  if (!name) {
    return false;
  }
  return NON_OVERRIDABLE_ROUTE_AGENTS.has(baseAgentName(name));
}

const ROUTE_AGENT_MAP: Record<string, string> = {
  "aegis-plan": "aegis-plan",
  "aegis-exec": "aegis-exec",
  "aegis-deep": "aegis-deep",
  "bounty-scope": "bounty-scope",
  "ctf-web": "ctf-web",
  "ctf-web3": "ctf-web3",
  "ctf-pwn": "ctf-pwn",
  "ctf-rev": "ctf-rev",
  "ctf-crypto": "ctf-crypto",
  "ctf-forensics": "ctf-forensics",
  "ctf-explore": "ctf-explore",
  "ctf-solve": "ctf-solve",
  "ctf-research": "ctf-research",
  "ctf-hypothesis": "ctf-hypothesis",
  "ctf-decoy-check": "ctf-decoy-check",
  "ctf-verify": "ctf-verify",
  "bounty-triage": "bounty-triage",
  "bounty-research": "bounty-research",
  "deep-plan": "deep-plan",
  "md-scribe": "md-scribe",
  "aegis-explore": "aegis-explore",
  "aegis-librarian": "aegis-librarian",
};

function currentRouting(config?: OrchestratorConfig) {
  return config?.routing ?? DEFAULT_ROUTING;
}

export function requiredDispatchSubagents(config?: OrchestratorConfig): string[] {
  const routing = currentRouting(config);
  const required = new Set<string>(Object.values(ROUTE_AGENT_MAP));

  for (const domain of [routing.ctf, routing.bounty]) {
    for (const phase of [domain.scan, domain.plan, domain.execute, domain.stuck, domain.failover]) {
      for (const routeName of Object.values(phase)) {
        required.add(ROUTE_AGENT_MAP[routeName] ?? routeName);
      }
    }
  }

  return [...required];
}

function fallbackFor(mode: Mode, targetType: TargetType, config?: OrchestratorConfig): string {
  const routing = currentRouting(config);
  if (mode === "CTF") {
    return routing.ctf.failover[targetType];
  }
  return routing.bounty.failover[targetType];
}

function dispatchScore(state: SessionState, subagentType: string): number {
  const health = state.dispatchHealthBySubagent[subagentType];
  if (!health) {
    return 0;
  }
  return (
    health.successCount * 2 -
    health.retryableFailureCount -
    health.hardFailureCount * 2 -
    health.consecutiveFailureCount * 3
  );
}

function capabilityCandidates(state: SessionState, config?: OrchestratorConfig): string[] {
  if (!config) {
    return [];
  }
  const profile =
    state.mode === "CTF"
      ? config.capability_profiles.ctf[state.targetType]
      : config.capability_profiles.bounty[state.targetType];
  return profile.required_subagents;
}

function chooseOperationalSubagent(
  routePrimary: string,
  state: SessionState,
  mappedSubagent: string,
  config?: OrchestratorConfig
): TaskDispatchDecision {
  const threshold = config?.auto_dispatch.operational_feedback_consecutive_failures ?? 2;
  const mappedHealth = state.dispatchHealthBySubagent[mappedSubagent];
  if (!mappedHealth || mappedHealth.consecutiveFailureCount < threshold) {
    return {
      subagent_type: mappedSubagent,
      reason: `route '${routePrimary}' mapped to subagent '${mappedSubagent}'`,
    };
  }

  const pool: string[] = [];
  const pushUnique = (value: string) => {
    if (value && !pool.includes(value)) {
      pool.push(value);
    }
  };

  pushUnique(mappedSubagent);
  pushUnique(fallbackFor(state.mode, state.targetType, config));
  for (const candidate of capabilityCandidates(state, config)) {
    pushUnique(candidate);
  }

  let best = mappedSubagent;
  let bestScore = dispatchScore(state, mappedSubagent);
  for (const candidate of pool) {
    if (candidate === mappedSubagent) {
      continue;
    }
    const score = dispatchScore(state, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (best === mappedSubagent) {
    return {
      subagent_type: mappedSubagent,
      reason: `mapped subagent '${mappedSubagent}' retained despite failure streak (${mappedHealth.consecutiveFailureCount}).`,
    };
  }

  return {
    subagent_type: best,
    reason: `operational feedback switched '${mappedSubagent}' -> '${best}' after ${mappedHealth.consecutiveFailureCount} consecutive failures`,
  };
}

export function decideAutoDispatch(
  routePrimary: string,
  state: SessionState,
  maxFailoverRetries: number,
  config?: OrchestratorConfig
): TaskDispatchDecision {
  const dynamicModelEnabled = Boolean(
    config?.dynamic_model?.enabled && config?.dynamic_model?.generate_variants
  );
  const modelCooldownMs = config?.dynamic_model?.health_cooldown_ms ?? 300_000;
  const maybeApplyModelFailover = (decision: TaskDispatchDecision): TaskDispatchDecision => {
    if (!dynamicModelEnabled || !decision.subagent_type) {
      return decision;
    }
    if (isNonOverridableSubagent(decision.subagent_type)) {
      return decision;
    }
    const resolved = resolveHealthyAgent(decision.subagent_type, state, modelCooldownMs);
    if (resolved === decision.subagent_type) {
      return decision;
    }
    return {
      subagent_type: resolved,
      reason: `${decision.reason}; model-failover '${decision.subagent_type}' -> '${resolved}'`,
    };
  };

  if (state.pendingTaskFailover && state.taskFailoverCount < maxFailoverRetries) {
    const fallback = fallbackFor(state.mode, state.targetType, config);
    return maybeApplyModelFailover({
      subagent_type: fallback,
      reason: `pending failover retry (${state.taskFailoverCount + 1}/${maxFailoverRetries}) after tool failure`,
    });
  }

  const mapped = ROUTE_AGENT_MAP[routePrimary] ?? routePrimary;
  if (!mapped) {
    return {
      reason: "no route-agent mapping found",
    };
  }

  if (isNonOverridableSubagent(mapped)) {
    return {
      subagent_type: mapped,
      reason: `route '${routePrimary}' is non-overridable and pinned to '${mapped}'`,
    };
  }

  const baseDecision = !config?.auto_dispatch.operational_feedback_enabled
    ? { subagent_type: mapped, reason: `route '${routePrimary}' mapped to subagent '${mapped}'` }
    : chooseOperationalSubagent(routePrimary, state, mapped, config);

  return maybeApplyModelFailover(baseDecision);
}
