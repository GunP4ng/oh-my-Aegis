import { AGENT_OVERRIDES } from "../install/agent-overrides";
import type { SessionState } from "../state/types";

export const MODEL_POOL = [
  "openai/gpt-5.3-codex",
  "opencode/glm-5-free",
  "opencode/minimax-2.5-free",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-opus-4.1",
] as const;

export type ModelId = (typeof MODEL_POOL)[number];

export const VARIANT_SEP = "--";

const MODEL_SHORT: Record<string, string> = {
  "openai/gpt-5.3-codex": "codex",
  "opencode/glm-5-free": "glm",
  "opencode/minimax-2.5-free": "minimax",
  "anthropic/claude-sonnet-4.5": "claude",
  "anthropic/claude-opus-4.1": "opus",
};

const SHORT_TO_MODEL: Record<string, ModelId> = {};
for (const [full, short] of Object.entries(MODEL_SHORT)) {
  SHORT_TO_MODEL[short] = full as ModelId;
}

const DEFAULT_AGENT_MODEL = "openai/gpt-5.3-codex";
const DEFAULT_AGENT_VARIANT = "medium";

const MODEL_VARIANTS: Record<string, string[]> = {
  "openai/gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
  "anthropic/claude-sonnet-4.5": ["low", "max"],
  "anthropic/claude-opus-4.1": ["low", "max"],
};

const MODELS_WITHOUT_VARIANT = new Set([
  "opencode/glm-5-free",
  "opencode/minimax-2.5-free",
]);

const MODEL_DEFAULT_VARIANT: Record<string, string> = {
  "openai/gpt-5.3-codex": "medium",
  "anthropic/claude-sonnet-4.5": "low",
  "anthropic/claude-opus-4.1": "low",
};

const NO_VARIANT_AGENTS = new Set([
  "explore-fallback",
  "librarian-fallback",
  "oracle-fallback",
]);

const DEFAULT_COOLDOWN_MS = 300_000;

const MODEL_ALTERNATIVES: Record<ModelId, ModelId[]> = {
  "openai/gpt-5.3-codex": [
    "opencode/glm-5-free",
    "opencode/minimax-2.5-free",
    "anthropic/claude-sonnet-4.5",
  ],
  "opencode/glm-5-free": [
    "opencode/minimax-2.5-free",
    "openai/gpt-5.3-codex",
    "anthropic/claude-sonnet-4.5",
  ],
  "opencode/minimax-2.5-free": [
    "opencode/glm-5-free",
    "openai/gpt-5.3-codex",
    "anthropic/claude-sonnet-4.5",
  ],
  "anthropic/claude-sonnet-4.5": [
    "openai/gpt-5.3-codex",
    "opencode/glm-5-free",
    "opencode/minimax-2.5-free",
  ],
  "anthropic/claude-opus-4.1": [
    "openai/gpt-5.3-codex",
    "opencode/glm-5-free",
    "opencode/minimax-2.5-free",
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

export function isKnownModelId(model: string): model is ModelId {
  return Object.prototype.hasOwnProperty.call(MODEL_SHORT, model);
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
  model: string,
  cooldownMs = DEFAULT_COOLDOWN_MS
): boolean {
  const entry = state.modelHealthByModel[model];
  if (!entry) {
    return true;
  }
  return Date.now() - entry.unhealthySince >= cooldownMs;
}

export function resolveHealthyModel(
  baseAgent: string,
  state: SessionState,
  cooldownMs = DEFAULT_COOLDOWN_MS
): string | undefined {
  if (NO_VARIANT_AGENTS.has(baseAgent)) {
    return agentModel(baseAgent);
  }
  const primaryModel = agentModel(baseAgent);
  if (!primaryModel) {
    return undefined;
  }
  if (isModelHealthy(state, primaryModel, cooldownMs)) {
    return primaryModel;
  }
  const alts = modelAlternatives(primaryModel);
  for (const alt of alts) {
    if (isModelHealthy(state, alt, cooldownMs)) {
      return alt;
    }
  }
  return primaryModel;
}

export function shouldGenerateVariants(agentName: string): boolean {
  return !NO_VARIANT_AGENTS.has(agentName) && !agentName.includes(VARIANT_SEP);
}

export function generateVariantEntries(
  agentName: string,
  baseProfile: { model: string; variant?: string }
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
    variant: baseProfile.variant ?? "",
  }));
}

function providerIdFromModel(model: string): string {
  const trimmed = model.trim();
  const idx = trimmed.indexOf("/");
  if (idx === -1) return trimmed;
  return trimmed.slice(0, idx);
}

function mapVariantAlias(model: string, variant: string): string | null {
  const provider = providerIdFromModel(model);
  const normalized = variant.trim().toLowerCase();
  if (!normalized) return null;

  if (provider === "openai") {
    if (normalized === "max") return "xhigh";
    if (normalized === "minimal") return "low";
    if (normalized === "none") return "low";
    return normalized;
  }
  if (provider === "google") {
    if (normalized === "xhigh") return "high";
    if (normalized === "max") return "high";
    if (normalized === "none") return "low";
    return normalized;
  }
  if (provider === "anthropic") {
    if (normalized === "high" || normalized === "xhigh" || normalized === "medium") return "max";
    if (normalized === "minimal" || normalized === "none") return "low";
    return normalized;
  }
  return normalized;
}

export function supportedVariantsForModel(model: string): string[] {
  return MODEL_VARIANTS[model] ?? [];
}

export function defaultVariantForModel(model: string): string {
  if (MODELS_WITHOUT_VARIANT.has(model) || providerIdFromModel(model) === "google") {
    return "";
  }
  return MODEL_DEFAULT_VARIANT[model] ?? DEFAULT_AGENT_VARIANT;
}

export function isVariantSupportedForModel(model: string, variant: string): boolean {
  if (MODELS_WITHOUT_VARIANT.has(model) || providerIdFromModel(model) === "google") {
    return variant.trim().length === 0;
  }
  const allowed = supportedVariantsForModel(model);
  if (allowed.length === 0) {
    return true;
  }
  return allowed.includes(variant.trim());
}

export function normalizeVariantForModel(
  model: string,
  requestedVariant: string,
  fallbackVariant = ""
): string {
  if (MODELS_WITHOUT_VARIANT.has(model)) {
    return "";
  }
  const provider = providerIdFromModel(model);
  const allowed = supportedVariantsForModel(model);
  const requested = requestedVariant.trim();
  const fallback = fallbackVariant.trim();

  if (provider === "google" && allowed.length === 0) {
    return "";
  }

  if (allowed.length === 0) {
    if (requested) return requested;
    if (fallback) return fallback;
    return defaultVariantForModel(model);
  }

  if (requested && allowed.includes(requested)) {
    return requested;
  }
  const mappedRequested = requested ? mapVariantAlias(model, requested) : null;
  if (mappedRequested && allowed.includes(mappedRequested)) {
    return mappedRequested;
  }

  if (fallback && allowed.includes(fallback)) {
    return fallback;
  }
  const mappedFallback = fallback ? mapVariantAlias(model, fallback) : null;
  if (mappedFallback && allowed.includes(mappedFallback)) {
    return mappedFallback;
  }
  return defaultVariantForModel(model);
}

export function resolveAgentExecutionProfile(
  agentName: string,
  options?: {
    preferredModel?: string;
    preferredVariant?: string;
  }
): { baseAgent: string; model: string; variant: string } {
  const baseAgent = baseAgentName(agentName);
  const baseProfile = AGENT_OVERRIDES[baseAgent] ?? {
    model: DEFAULT_AGENT_MODEL,
    variant: DEFAULT_AGENT_VARIANT,
  };
  const suffixIndex = agentName.indexOf(VARIANT_SEP);
  const legacyModel =
    suffixIndex !== -1 ? SHORT_TO_MODEL[agentName.slice(suffixIndex + VARIANT_SEP.length)] : undefined;
  const seedModel = legacyModel ?? baseProfile.model;
  const model =
    options?.preferredModel && options.preferredModel.trim().length > 0
      ? options.preferredModel.trim()
      : seedModel;
  const variant = normalizeVariantForModel(model, options?.preferredVariant ?? "", baseProfile.variant);
  return {
    baseAgent,
    model,
    variant,
  };
}
