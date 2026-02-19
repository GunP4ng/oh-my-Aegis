import { AGENT_OVERRIDES } from "../install/agent-overrides";
import type { SessionState } from "../state/types";

export const MODEL_POOL = [
  "openai/gpt-5.3-codex",
  "google/antigravity-gemini-3-flash",
  "google/antigravity-gemini-3-pro",
] as const;

export type ModelId = (typeof MODEL_POOL)[number];

export const VARIANT_SEP = "--";

const MODEL_SHORT: Record<string, string> = {
  "openai/gpt-5.3-codex": "codex",
  "google/antigravity-gemini-3-flash": "flash",
  "google/antigravity-gemini-3-pro": "pro",
};

const SHORT_TO_MODEL: Record<string, ModelId> = {};
for (const [full, short] of Object.entries(MODEL_SHORT)) {
  SHORT_TO_MODEL[short] = full as ModelId;
}

const NO_VARIANT_AGENTS = new Set([
  "explore-fallback",
  "librarian-fallback",
  "oracle-fallback",
]);

const DEFAULT_COOLDOWN_MS = 300_000;

const MODEL_ALTERNATIVES: Record<ModelId, ModelId[]> = {
  "openai/gpt-5.3-codex": [
    "google/antigravity-gemini-3-flash",
    "google/antigravity-gemini-3-pro",
  ],
  "google/antigravity-gemini-3-flash": [
    "openai/gpt-5.3-codex",
    "google/antigravity-gemini-3-pro",
  ],
  "google/antigravity-gemini-3-pro": [
    "openai/gpt-5.3-codex",
    "google/antigravity-gemini-3-flash",
  ],
};

export function agentModel(agentName: string): ModelId | undefined {
  const idx = agentName.indexOf(VARIANT_SEP);
  if (idx !== -1) {
    const short = agentName.slice(idx + VARIANT_SEP.length);
    const model = SHORT_TO_MODEL[short];
    if (model) {
      return model;
    }
  }

  const base = baseAgentName(agentName);
  const override = AGENT_OVERRIDES[base];
  if (override) {
    return override.model as ModelId;
  }
  return undefined;
}

export function modelAlternatives(model: ModelId): ModelId[] {
  return MODEL_ALTERNATIVES[model] ?? [];
}

export function variantAgentName(baseAgent: string, model: ModelId): string {
  const short = MODEL_SHORT[model];
  if (!short) {
    return baseAgent;
  }
  return `${baseAgent}${VARIANT_SEP}${short}`;
}

export function baseAgentName(agentName: string): string {
  const idx = agentName.indexOf(VARIANT_SEP);
  if (idx === -1) {
    return agentName;
  }
  return agentName.slice(0, idx);
}

export function isModelHealthy(
  state: SessionState,
  model: ModelId,
  cooldownMs = DEFAULT_COOLDOWN_MS
): boolean {
  const entry = state.modelHealthByModel[model];
  if (!entry) {
    return true;
  }
  return Date.now() - entry.unhealthySince >= cooldownMs;
}

export function resolveHealthyAgent(
  baseAgent: string,
  state: SessionState,
  cooldownMs = DEFAULT_COOLDOWN_MS
): string {
  if (NO_VARIANT_AGENTS.has(baseAgent)) {
    return baseAgent;
  }
  const primaryModel = agentModel(baseAgent);
  if (!primaryModel) {
    return baseAgent;
  }
  if (isModelHealthy(state, primaryModel, cooldownMs)) {
    return baseAgent;
  }
  const alts = modelAlternatives(primaryModel);
  for (const alt of alts) {
    if (isModelHealthy(state, alt, cooldownMs)) {
      return variantAgentName(baseAgent, alt);
    }
  }
  return baseAgent;
}

export function shouldGenerateVariants(agentName: string): boolean {
  return !NO_VARIANT_AGENTS.has(agentName) && !agentName.includes(VARIANT_SEP);
}

export function generateVariantEntries(
  agentName: string,
  baseProfile: { model: string; variant: string }
): Array<{ name: string; model: string; variant: string }> {
  if (!shouldGenerateVariants(agentName)) {
    return [];
  }
  const primaryModel = baseProfile.model as ModelId;
  const alts = MODEL_ALTERNATIVES[primaryModel];
  if (!alts) {
    return [];
  }
  return alts.map((altModel) => ({
    name: variantAgentName(agentName, altModel),
    model: altModel,
    variant: baseProfile.variant,
  }));
}
