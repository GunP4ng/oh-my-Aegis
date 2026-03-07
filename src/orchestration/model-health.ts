import type { ProviderFamily, SessionState } from "../state/types";

export const MODEL_POOL = [
  "openai/gpt-5.4",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.2",
  "model_cli/claude-sonnet-4.6",
  "model_cli/claude-opus-4.6",
  "model_cli/claude-haiku-4.5",
  "model_cli/gemini-3.1-pro",
  "model_cli/gemini-3.1-flash",
  "model_cli/gemini-2.5-pro",
  "model_cli/gemini-2.5-flash",
  "model_cli/gemini-2.5-flash-lite",
] as const;

export type ModelId = (typeof MODEL_POOL)[number];

export const VARIANT_SEP = "--";

const MODEL_SHORT: Record<string, string> = {
  "openai/gpt-5.4": "gpt54",
  "openai/gpt-5.3-codex": "codex",
  "openai/gpt-5.2": "gpt52",
  "model_cli/claude-sonnet-4.6": "claude46",
  "model_cli/claude-opus-4.6": "opus46",
  "model_cli/claude-haiku-4.5": "haiku45",
  "model_cli/gemini-3.1-pro": "gemini31",
  "model_cli/gemini-3.1-flash": "gemini31f",
  "model_cli/gemini-2.5-pro": "gemini",
  "model_cli/gemini-2.5-flash": "gemini25f",
  "model_cli/gemini-2.5-flash-lite": "gemini25fl",
};

const SHORT_TO_MODEL: Record<string, ModelId> = {};
for (const [full, short] of Object.entries(MODEL_SHORT)) {
  SHORT_TO_MODEL[short] = full as ModelId;
}

const DEFAULT_AGENT_VARIANT = "medium";
export const EXECUTION_MODEL = "openai/gpt-5.3-codex";
export const THINKING_MODEL = "openai/gpt-5.2";
const EXECUTION_VARIANT = "high";
export const PLANNING_MODEL = "model_cli/claude-sonnet-4.6";
const PLANNING_VARIANT = "low";
const VERIFICATION_VARIANT = "max";
export const EXPLORATION_MODEL = "model_cli/gemini-3.1-pro";
const EXPLORATION_VARIANT = "";

export type AgentLane = "execution" | "planning" | "exploration";

export type LaneRoleProfile = {
  model: string;
  variant: string;
};

export type LaneRoleProfiles = {
  execution: LaneRoleProfile;
  planning: LaneRoleProfile;
  exploration: LaneRoleProfile;
};

const DEFAULT_LANE_ROLE_PROFILES: LaneRoleProfiles = {
  execution: { model: EXECUTION_MODEL, variant: EXECUTION_VARIANT },
  planning: { model: PLANNING_MODEL, variant: PLANNING_VARIANT },
  exploration: { model: EXPLORATION_MODEL, variant: EXPLORATION_VARIANT },
};

function resolveLaneRoleProfiles(overrides?: Partial<LaneRoleProfiles>): LaneRoleProfiles {
  if (!overrides) {
    return DEFAULT_LANE_ROLE_PROFILES;
  }

  const pick = (lane: AgentLane): LaneRoleProfile => {
    const candidate = overrides[lane];
    if (!candidate) {
      return DEFAULT_LANE_ROLE_PROFILES[lane];
    }
    const model = typeof candidate.model === "string" ? candidate.model.trim() : "";
    const variant = typeof candidate.variant === "string" ? candidate.variant.trim() : "";
    return {
      model: model || DEFAULT_LANE_ROLE_PROFILES[lane].model,
      variant: variant || DEFAULT_LANE_ROLE_PROFILES[lane].variant,
    };
  };

  return {
    execution: pick("execution"),
    planning: pick("planning"),
    exploration: pick("exploration"),
  };
}

function resolveAgentLane(baseAgent: string): AgentLane {
  if (
    baseAgent.startsWith("aegis-explore")
    || baseAgent.includes("librarian")
    || baseAgent.includes("explore")
    || baseAgent.includes("research")
    || baseAgent.includes("forensics")
    || baseAgent.includes("oracle-fallback")
    || baseAgent.includes("scribe")
  ) {
    return "exploration";
  }

  if (
    baseAgent.includes("plan")
    || baseAgent.includes("scope")
    || baseAgent.includes("hypothesis")
    || baseAgent.includes("decoy-check")
    || baseAgent.includes("verify")
  ) {
    return "planning";
  }

  return "execution";
}

function baseAgentRuntimeProfile(
  baseAgent: string,
  roleProfiles?: Partial<LaneRoleProfiles>
): { model: string; variant: string } {
  const lane = resolveAgentLane(baseAgent);
  const profiles = resolveLaneRoleProfiles(roleProfiles);
  const laneProfile = profiles[lane];
  const laneVariant =
    lane === "planning" && baseAgent.includes("verify") ? VERIFICATION_VARIANT : laneProfile.variant;
  return {
    model: laneProfile.model,
    variant: laneVariant,
  };
}

export function defaultProfileForAgentLane(
  agentName: string,
  roleProfiles?: Partial<LaneRoleProfiles>
): { model: string; variant: string } {
  const baseAgent = baseAgentName(agentName);
  return baseAgentRuntimeProfile(baseAgent, roleProfiles);
}

const MODEL_VARIANTS: Record<string, string[]> = {
  "openai/gpt-5.4": ["low", "medium", "high", "xhigh"],
  "openai/gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
  "openai/gpt-5.2": ["low", "medium", "high", "xhigh"],
  "model_cli/claude-sonnet-4.6": ["low", "medium", "high"],
  "model_cli/claude-opus-4.6": ["low", "medium", "high"],
  "model_cli/claude-haiku-4.5": ["low", "medium", "high"],
  "model_cli/gemini-3.1-pro": [],
  "model_cli/gemini-3.1-flash": [],
  "model_cli/gemini-2.5-pro": [],
  "model_cli/gemini-2.5-flash": [],
  "model_cli/gemini-2.5-flash-lite": [],
};

const MODEL_DEFAULT_VARIANT: Record<string, string> = {
  "openai/gpt-5.4": "medium",
  "openai/gpt-5.3-codex": "medium",
  "openai/gpt-5.2": "medium",
  "model_cli/claude-sonnet-4.6": "low",
  "model_cli/claude-opus-4.6": "low",
  "model_cli/claude-haiku-4.5": "low",
  "model_cli/gemini-3.1-pro": "",
  "model_cli/gemini-3.1-flash": "",
  "model_cli/gemini-2.5-pro": "",
  "model_cli/gemini-2.5-flash": "",
  "model_cli/gemini-2.5-flash-lite": "",
};

function isProviderAvailableByEnv(providerId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const has = (key: string) => {
    const value = env[key];
    return typeof value === "string" && value.trim().length > 0;
  };
  if (providerId === "openai") {
    return true;
  }
  if (providerId === "google") {
    return has("GOOGLE_API_KEY") || has("GEMINI_API_KEY");
  }
  if (providerId === "anthropic") {
    return has("ANTHROPIC_API_KEY");
  }
  return false;
}

function isModelCliAvailable(model: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const has = (key: string) => {
    const value = env[key];
    return typeof value === "string" && value.trim().length > 0;
  };
  const modelName = model.slice("model_cli/".length);
  if (modelName.startsWith("claude-")) {
    return has("ANTHROPIC_API_KEY") || has("AEGIS_CLAUDE_CODE_CLI_BIN");
  }
  if (modelName.startsWith("gemini-")) {
    return has("GOOGLE_API_KEY") || has("GEMINI_API_KEY") || has("AEGIS_GEMINI_CLI_BIN");
  }
  return false;
}

function isModelProviderAvailable(model: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const providerId = providerIdFromModel(model);
  if (providerId === "model_cli") {
    return isModelCliAvailable(model, env);
  }
  return isProviderAvailableByEnv(providerId, env);
}

const NO_VARIANT_AGENTS = new Set([
  "explore-fallback",
  "librarian-fallback",
  "oracle-fallback",
]);

const DEFAULT_COOLDOWN_MS = 300_000;

const MODEL_ALTERNATIVES: Record<ModelId, ModelId[]> = {
  "openai/gpt-5.4": [
    "openai/gpt-5.3-codex",
    "openai/gpt-5.2",
    "model_cli/claude-sonnet-4.6",
  ],
  "openai/gpt-5.3-codex": [
    "openai/gpt-5.4",
    "openai/gpt-5.2",
    "model_cli/claude-sonnet-4.6",
  ],
  "openai/gpt-5.2": [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "model_cli/claude-sonnet-4.6",
  ],
  "model_cli/claude-sonnet-4.6": [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.2",
  ],
  "model_cli/claude-opus-4.6": [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.2",
  ],
  "model_cli/claude-haiku-4.5": [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.2",
  ],
  "model_cli/gemini-3.1-pro": [
    "model_cli/claude-sonnet-4.6",
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.2",
  ],
  "model_cli/gemini-3.1-flash": [
    "model_cli/claude-sonnet-4.6",
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.2",
  ],
  "model_cli/gemini-2.5-pro": [
    "model_cli/claude-sonnet-4.6",
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.2",
  ],
  "model_cli/gemini-2.5-flash": [
    "model_cli/claude-sonnet-4.6",
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.2",
  ],
  "model_cli/gemini-2.5-flash-lite": [
    "model_cli/gemini-2.5-flash",
    "model_cli/claude-sonnet-4.6",
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.2",
  ],
};

export function agentModel(agentName: string): string | undefined {
  const idx = agentName.indexOf(VARIANT_SEP);
  if (idx !== -1) {
    const short = agentName.slice(idx + VARIANT_SEP.length);
    const model = SHORT_TO_MODEL[short];
    if (model) {
      return model;
    }
  }

  const base = baseAgentName(agentName);
  const baseProfile = baseAgentRuntimeProfile(base);
  return baseProfile.model || undefined;
}

export function modelAlternatives(model: string): ModelId[] {
  if (!isKnownModelId(model)) {
    return [];
  }
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
  cooldownMs = DEFAULT_COOLDOWN_MS,
  roleProfiles?: Partial<LaneRoleProfiles>,
  agentModelOverrides?: Record<string, { model: string; variant?: string }>
): string | undefined {
  const agentOverride = agentModelOverrides?.[baseAgentName(baseAgent)];
  const baseProfile = baseAgentRuntimeProfile(baseAgent, roleProfiles);
  const preferredModel = agentOverride?.model ?? baseProfile.model;

  if (NO_VARIANT_AGENTS.has(baseAgent)) {
    const fallbackModel = preferredModel ?? agentModel(baseAgent);
    return fallbackModel ?? undefined;
  }
  const primaryModel = preferredModel ?? agentModel(baseAgent);
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
  if (!isKnownModelId(baseProfile.model)) {
    return [];
  }
  const primaryModel = baseProfile.model;
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

export function providerIdFromModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "";
  const idx = trimmed.indexOf("/");
  if (idx === -1) return trimmed.toLowerCase();
  return trimmed.slice(0, idx).toLowerCase();
}

export function providerFamilyFromModel(model: string): ProviderFamily {
  const provider = providerIdFromModel(model);
  const trimmed = model.trim();
  const slashIndex = trimmed.indexOf("/");
  const modelName = slashIndex === -1 ? "" : trimmed.slice(slashIndex + 1).toLowerCase();
  if (!provider) {
    return "unknown";
  }
  if (provider === "openai") {
    return "openai";
  }
  if (provider === "google" || provider === "gemini") {
    return "google";
  }
  if (provider === "anthropic") {
    return "anthropic";
  }
  if (provider === "model_cli") {
    if (modelName.startsWith("claude-")) {
      return "anthropic";
    }
    if (modelName.startsWith("gemini-")) {
      return "google";
    }
  }
  if (provider === "xai") {
    return "xai";
  }
  if (provider === "meta" || provider === "facebook") {
    return "meta";
  }
  return "unknown";
}

function mapVariantAlias(model: string, variant: string): string | null {
  const family = providerFamilyFromModel(model);
  const normalized = variant.trim().toLowerCase();
  if (!normalized) return null;

  if (family === "openai") {
    if (normalized === "max") return "xhigh";
    if (normalized === "minimal") return "low";
    if (normalized === "none") return "low";
    return normalized;
  }
  if (family === "google") {
    if (normalized === "xhigh") return "high";
    if (normalized === "max") return "high";
    if (normalized === "none") return "low";
    return normalized;
  }
  if (family === "anthropic") {
    if (normalized === "max" || normalized === "xhigh") return "high";
    if (normalized === "minimal" || normalized === "none") return "low";
    return normalized;
  }
  return normalized;
}

export function supportedVariantsForModel(model: string): string[] {
  return MODEL_VARIANTS[model] ?? [];
}

export function defaultVariantForModel(model: string): string {
  if (providerFamilyFromModel(model) === "google") {
    return "";
  }
  return MODEL_DEFAULT_VARIANT[model] ?? DEFAULT_AGENT_VARIANT;
}

export function isVariantSupportedForModel(model: string, variant: string): boolean {
  if (providerFamilyFromModel(model) === "google") {
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
  const family = providerFamilyFromModel(model);
  const allowed = supportedVariantsForModel(model);
  const requested = requestedVariant.trim();
  const fallback = fallbackVariant.trim();

  if (family === "google" && allowed.length === 0) {
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
    roleProfiles?: Partial<LaneRoleProfiles>;
    agentModelOverrides?: Record<string, { model: string; variant?: string }>;
  }
): { baseAgent: string; model: string; variant: string } {
  const baseAgent = baseAgentName(agentName);
  const baseProfile = baseAgentRuntimeProfile(baseAgent, options?.roleProfiles);
  const suffixIndex = agentName.indexOf(VARIANT_SEP);
  const legacyModel =
    suffixIndex !== -1 ? SHORT_TO_MODEL[agentName.slice(suffixIndex + VARIANT_SEP.length)] : undefined;

  // agent_model_overrides: per-agent model config (highest priority after explicit user args)
  const agentOverride = options?.agentModelOverrides?.[baseAgent];
  const seedModel = legacyModel ?? agentOverride?.model ?? baseProfile.model;
  const seedVariant = agentOverride?.variant ?? baseProfile.variant;

  const model =
    options?.preferredModel && options.preferredModel.trim().length > 0
      ? options.preferredModel.trim()
      : seedModel;
  const variant = normalizeVariantForModel(model, options?.preferredVariant ?? "", seedVariant);
  return {
    baseAgent,
    model,
    variant,
  };
}
