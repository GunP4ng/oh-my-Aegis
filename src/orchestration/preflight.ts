import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import { isModelHealthy } from "./model-health";

// Currently only "model:exists" is enforced at runtime.
// "tool:task" entries are reserved for future capability tracking.
export const ROUTE_CAPABILITIES: Record<string, string[]> = {
  "ctf-rev": ["model:exists"],
  "ctf-pwn": ["model:exists"],
  "ctf-web": ["model:exists"],
  "ctf-web3": ["model:exists"],
  "ctf-crypto": ["model:exists"],
  "ctf-forensics": ["model:exists"],
  "ctf-solve": ["model:exists"],
  "ctf-explore": ["model:exists"],
  "ctf-research": ["model:exists"],
  "ctf-hypothesis": ["model:exists"],
  "ctf-decoy-check": ["model:exists"],
  "ctf-verify": ["model:exists"],
  "aegis-deep": ["model:exists"],
  "aegis-plan": ["model:exists"],
  "aegis-exec": ["model:exists"],
  "aegis-explore": ["model:exists"],
  "aegis-librarian": ["model:exists"],
  "bounty-triage": ["model:exists"],
  "bounty-research": ["model:exists"],
  "bounty-scope": ["model:exists"],
  "md-scribe": ["model:exists"],
  "deep-plan": ["model:exists"],
};

export interface PreflightResult {
  ok: boolean;
  failedCapability?: string;
  fallbackRoute?: string;
}

export function checkRoutePreflight(
  route: string,
  state: SessionState,
  config: OrchestratorConfig,
  resolvedModel?: string
): PreflightResult {
  const capabilities = ROUTE_CAPABILITIES[route];
  if (!capabilities) {
    return { ok: true };
  }

  const cooldownMs = config.dynamic_model?.health_cooldown_ms ?? 300_000;

  for (const cap of capabilities) {
    if (cap === "model:exists" && resolvedModel) {
      if (!isModelHealthy(state, resolvedModel, cooldownMs)) {
        const fallbackRoute = getFallbackRoute(state, config);
        return { ok: false, failedCapability: cap, fallbackRoute };
      }
    }
  }

  return { ok: true };
}

function getFallbackRoute(state: SessionState, config: OrchestratorConfig): string {
  const routing = state.mode === "CTF" ? config.routing?.ctf : config.routing?.bounty;
  return routing?.failover?.[state.targetType] ?? "md-scribe";
}
