import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OrchestratorConfig } from "../config/schema";
import { OrchestratorConfigSchema } from "../config/schema";
import {
  hasAegisInstallMarker,
  hasOpencodeConfigFile,
  resolveOpencodeDirCandidates,
  resolveOpencodeConfigPathInDir,
} from "../config/opencode-config-path";
import { createBuiltinMcps } from "../mcp";
import {
  defaultProfileForAgentLane,
  EXECUTION_MODEL,
  PLANNING_MODEL,
  EXPLORATION_MODEL,
  THINKING_MODEL,
  providerIdFromModel,
} from "../orchestration/model-health";
import { requiredDispatchSubagents } from "../orchestration/task-dispatch";
import { stripJsonComments } from "../utils/json";
import { AGENT_PROMPTS, AGENT_PERMISSIONS } from "../agents/domain-prompts";

type JsonObject = Record<string, unknown>;
type ProviderAvailabilityOverrides = Partial<Record<string, boolean>>;

const DEFAULT_AGENT_MODEL = EXECUTION_MODEL;
const DEFAULT_AGENT_VARIANT = "medium";
const REQUIRED_GEMINI_AUTH_PLUGIN = "opencode-gemini-auth@latest";
const GEMINI_AUTH_PACKAGE_NAME = "opencode-gemini-auth";
const REQUIRED_CLAUDE_AUTH_PLUGIN = "opencode-cluade-auth@latest";
const CLAUDE_AUTH_PACKAGE_NAME = "opencode-cluade-auth";
const REQUIRED_ANTIGRAVITY_AUTH_PLUGIN = "opencode-antigravity-auth@latest";
const ANTIGRAVITY_AUTH_PACKAGE_NAME = "opencode-antigravity-auth";
const REQUIRED_OPENAI_CODEX_AUTH_PLUGIN = "opencode-openai-codex-auth@latest";
const OPENAI_CODEX_AUTH_PACKAGE_NAME = "opencode-openai-codex-auth";
const DEFAULT_GOOGLE_PROVIDER_NAME = "Google";
const DEFAULT_GOOGLE_PROVIDER_NPM = "@ai-sdk/google";
const DEFAULT_OPENAI_PROVIDER_NAME = "OpenAI";
const DEFAULT_ANTHROPIC_PROVIDER_NAME = "Anthropic";
const DEFAULT_ANTHROPIC_PROVIDER_NPM = "@ai-sdk/anthropic";
const DEFAULT_OPENAI_PROVIDER_OPTIONS: JsonObject = {
  reasoningEffort: "medium",
  reasoningSummary: "auto",
  textVerbosity: "medium",
  include: ["reasoning.encrypted_content"],
  store: false,
};
const DEFAULT_GOOGLE_PROVIDER_MODELS: Record<string, JsonObject> = {
  "antigravity-gemini-3-pro": {
    name: "Antigravity Gemini 3 Pro",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_535,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
  },
  "antigravity-gemini-3-flash": {
    name: "Antigravity Gemini 3 Flash",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_536,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
  },
  "gemini-3-pro-preview": {
    name: "Gemini 3 Pro Preview",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_535,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
    options: {
      thinkingConfig: {
        thinkingLevel: "high",
        includeThoughts: true,
      },
    },
  },
  "gemini-3-flash-preview": {
    name: "Gemini 3 Flash Preview",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_536,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
    options: {
      thinkingConfig: {
        thinkingLevel: "high",
        includeThoughts: true,
      },
    },
  },
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_535,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
    options: {
      thinkingConfig: {
        thinkingBudget: 8192,
        includeThoughts: true,
      },
    },
  },
  "gemini-2.5-flash": {
    name: "Gemini 2.5 Flash",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_536,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
    options: {
      thinkingConfig: {
        thinkingBudget: 8192,
        includeThoughts: true,
      },
    },
  },
  "gemini-2.5-flash-lite": {
    name: "Gemini 2.5 Flash Lite",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_536,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
  },
  "gemini-3.1-flash-lite-preview": {
    name: "Gemini 3.1 Flash Lite Preview",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_536,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
  },
  "gemini-3.1-pro-preview": {
    name: "Gemini 3.1 Pro Preview",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_535,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
    options: {
      thinkingConfig: {
        thinkingLevel: "high",
        includeThoughts: true,
      },
    },
  },
};
const DEFAULT_OPENAI_PROVIDER_MODELS: Record<string, JsonObject> = {
  "gpt-5.4": {
    name: "GPT 5.4 (OAuth)",
    limit: { context: 272_000, output: 128_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
    variants: {
      none: { reasoningEffort: "none", reasoningSummary: "auto", textVerbosity: "medium" },
      low: { reasoningEffort: "low", reasoningSummary: "auto", textVerbosity: "medium" },
      medium: { reasoningEffort: "medium", reasoningSummary: "auto", textVerbosity: "medium" },
      high: { reasoningEffort: "high", reasoningSummary: "detailed", textVerbosity: "medium" },
      xhigh: { reasoningEffort: "xhigh", reasoningSummary: "detailed", textVerbosity: "medium" },
    },
  },
  "gpt-5.2": {
    name: "GPT 5.2 (OAuth)",
    limit: { context: 272_000, output: 128_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
    variants: {
      none: { reasoningEffort: "none", reasoningSummary: "auto", textVerbosity: "medium" },
      low: { reasoningEffort: "low", reasoningSummary: "auto", textVerbosity: "medium" },
      medium: { reasoningEffort: "medium", reasoningSummary: "auto", textVerbosity: "medium" },
      high: { reasoningEffort: "high", reasoningSummary: "detailed", textVerbosity: "medium" },
      xhigh: { reasoningEffort: "xhigh", reasoningSummary: "detailed", textVerbosity: "medium" },
    },
  },
  "gpt-5.2-codex": {
    name: "GPT 5.2 Codex (OAuth)",
    limit: { context: 272_000, output: 128_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
    variants: {
      low: { reasoningEffort: "low", reasoningSummary: "auto", textVerbosity: "medium" },
      medium: { reasoningEffort: "medium", reasoningSummary: "auto", textVerbosity: "medium" },
      high: { reasoningEffort: "high", reasoningSummary: "detailed", textVerbosity: "medium" },
      xhigh: { reasoningEffort: "xhigh", reasoningSummary: "detailed", textVerbosity: "medium" },
    },
  },
  "gpt-5.1-codex-max": {
    name: "GPT 5.1 Codex Max (OAuth)",
    limit: { context: 272_000, output: 128_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
    variants: {
      low: { reasoningEffort: "low", reasoningSummary: "detailed", textVerbosity: "medium" },
      medium: { reasoningEffort: "medium", reasoningSummary: "detailed", textVerbosity: "medium" },
      high: { reasoningEffort: "high", reasoningSummary: "detailed", textVerbosity: "medium" },
      xhigh: { reasoningEffort: "xhigh", reasoningSummary: "detailed", textVerbosity: "medium" },
    },
  },
};
const DEFAULT_ANTHROPIC_PROVIDER_MODELS: Record<string, JsonObject> = {
  "claude-sonnet-4.5": {
    name: "Claude Sonnet 4.5",
    limit: { context: 200_000, output: 64_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
    variants: {
      low: { thinking: { type: "enabled", budget_tokens: 4_096 } },
      max: { thinking: { type: "enabled", budget_tokens: 32_000 } },
    },
  },
  "claude-opus-4.1": {
    name: "Claude Opus 4.1",
    limit: { context: 200_000, output: 64_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
    variants: {
      low: { thinking: { type: "enabled", budget_tokens: 8_192 } },
      max: { thinking: { type: "enabled", budget_tokens: 48_000 } },
    },
  },
  "claude-sonnet-4-6": {
    name: "Claude Sonnet 4.6",
    limit: { context: 200_000, output: 64_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
  },
  "claude-opus-4-6": {
    name: "Claude Opus 4.6",
    limit: { context: 200_000, output: 64_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
  },
  "claude-haiku-4-5": {
    name: "Claude Haiku 4.5",
    limit: { context: 200_000, output: 64_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
  },
};
const LEGACY_MODEL_ID_REMAP: Record<string, string> = {
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
  "gemini-3.1-flash": "gemini-3.1-flash-lite-preview",
  "claude-sonnet-4.6": "claude-sonnet-4-6",
  "claude-opus-4.6": "claude-opus-4-6",
  "claude-haiku-4.5": "claude-haiku-4-5",
};

const NPM_REGISTRY_LATEST_PREFIX = "https://registry.npmjs.org/";
const NPM_LATEST_SUFFIX = "/latest";
const VERSION_RESOLVE_TIMEOUT_MS = 5_000;
const DEFAULT_AEGIS_AGENT = "Aegis";
const LEGACY_ORCHESTRATOR_AGENTS = ["build", "Build", "prometheus", "Prometheus", "hephaestus", "Hephaestus"] as const;
const BUILTIN_PRIMARY_ORCHESTRATOR_AGENTS = ["build", "plan"] as const;

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function isProviderAvailableByEnv(
  providerId: string,
  env: NodeJS.ProcessEnv = process.env,
  overrides: ProviderAvailabilityOverrides = {}
): boolean {
  const override = overrides[providerId];
  if (typeof override === "boolean") {
    return override;
  }
  const has = (key: string) => {
    const v = env[key];
    return typeof v === "string" && v.trim().length > 0;
  };
  switch (providerId) {
    case "openai":
      return true;
    case "google":
      return true;
    case "anthropic":
      return has("ANTHROPIC_API_KEY");
    case "opencode":
      return has("OPENCODE_API_KEY");
    default:
      return false;
  }
}

function isModelAvailableByEnv(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
  overrides: ProviderAvailabilityOverrides = {}
): boolean {
  return isProviderAvailableByEnv(providerIdFromModel(model), env, overrides);
}


function resolveModelByEnvironment(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
  overrides: ProviderAvailabilityOverrides = {}
): string {
  const providerId = providerIdFromModel(model);
  if (!providerId) return model;

  if (isModelAvailableByEnv(model, env, overrides)) {
    return model;
  }

  const fallbackPool: string[] = [
    DEFAULT_AGENT_MODEL,
  ];
  for (const candidate of fallbackPool) {
    if (isModelAvailableByEnv(candidate, env, overrides)) {
      return candidate;
    }
  }

  return model;
}

const DEFAULT_AEGIS_CONFIG = {
  enabled: true,
  strict_readiness: true,
  enable_injection_logging: true,
  enforce_todo_single_in_progress: true,
  enforce_todo_flow_non_scan: true,
  enforce_todo_granularity_non_scan: true,
  todo_min_items_non_scan: 2,
  parallel: {
    queue_enabled: true,
    max_concurrent_per_provider: 2,
    provider_caps: {},
    auto_dispatch_scan: true,
    auto_dispatch_hypothesis: true,
    bounty_scan: {
      max_tracks: 3,
      triage_tracks: 2,
      research_tracks: 1,
      scope_recheck_tracks: 0,
    },
  },
  comment_checker: {
    enabled: true,
    only_in_bounty: true,
    min_added_lines: 12,
    max_comment_ratio: 0.35,
    max_comment_lines: 25,
  },
  rules_injector: {
    enabled: true,
    max_files: 6,
    max_chars_per_file: 3_000,
    max_total_chars: 12_000,
  },
  recovery: {
    enabled: true,
    empty_message_sanitizer: true,
    auto_compact_on_context_failure: true,
    context_window_proactive_compaction: true,
    context_window_proactive_threshold_ratio: 0.9,
    context_window_proactive_rearm_ratio: 0.75,
    edit_error_hint: true,
    thinking_block_validator: true,
    non_interactive_env: true,
    session_recovery: true,
    context_window_recovery: true,
    context_window_recovery_cooldown_ms: 15_000,
    context_window_recovery_max_attempts_per_session: 6,
  },
  interactive: {
    enabled: false,
    enabled_in_ctf: true,
    enabled_in_bounty: false,
  },
  tui_notifications: {
    enabled: false,
    throttle_ms: 5_000,
    startup_toast: true,
    startup_terminal_banner: false,
  },
  memory: {
    enabled: true,
    storage_dir: ".Aegis/memory",
  },
  sequential_thinking: {
    enabled: true,
    activate_phases: ["PLAN"],
    activate_targets: ["REV", "CRYPTO"],
    activate_on_stuck: true,
    disable_with_thinking_model: true,
    tool_name: "aegis_think",
  },
  auto_loop: {
    enabled: true,
    only_when_ultrawork: true,
    idle_delay_ms: 350,
    max_iterations: 200,
    stop_on_verified: true,
  },
  target_detection: {
    enabled: true,
    lock_after_first: true,
    only_in_scan: true,
  },
  notes: {
    root_dir: ".Aegis",
  },
  ctf_fast_verify: {
    enabled: true,
    enforce_all_targets: false,
    risky_targets: ["PWN", "REV", "CRYPTO"],
    require_nonempty_candidate: true,
  },
  default_mode: "BOUNTY",
  enforce_mode_header: true,
  allow_free_text_signals: false,
  stuck_threshold: 2,
  dynamic_model: {
    enabled: true,
    health_cooldown_ms: 300_000,
    generate_variants: true,
    thinking_model: THINKING_MODEL,
    role_profiles: {
      execution: { model: EXECUTION_MODEL, variant: "high" },
      planning: { model: PLANNING_MODEL, variant: "low" },
      exploration: { model: EXPLORATION_MODEL, variant: "" },
    },
    agent_model_overrides: {} as Record<string, { model: string; variant: string }>,
  },
  auto_dispatch: {
    enabled: true,
    preserve_user_category: true,
    max_failover_retries: 2,
    operational_feedback_enabled: false,
    operational_feedback_consecutive_failures: 2,
  },
};

export interface ApplyAegisConfigOptions {
  pluginEntry: string;
  opencodeDirOverride?: string;
  environment?: NodeJS.ProcessEnv;
  backupExistingConfig?: boolean;
  claudeAuthPluginEntry?: string;
  geminiAuthPluginEntry?: string;
  antigravityAuthPluginEntry?: string;
  openAICodexAuthPluginEntry?: string;
  ensureClaudeAuthPlugin?: boolean;
  ensureGeminiAuthPlugin?: boolean;
  ensureAntigravityAuthPlugin?: boolean;
  ensureOpenAICodexAuthPlugin?: boolean;
  ensureGoogleProviderCatalog?: boolean;
  ensureOpenAIProviderCatalog?: boolean;
  ensureAnthropicProviderCatalog?: boolean;
}

export interface ApplyAegisConfigResult {
  opencodePath: string;
  aegisPath: string;
  backupPath: string | null;
  pluginEntry: string;
  addedAgents: string[];
  ensuredBuiltinMcps: string[];
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf-8");
  if (!raw.trim()) {
    return {};
  }
  const parsed = JSON.parse(stripJsonComments(raw));
  if (!isObject(parsed)) {
    throw new Error(`JSON root must be object: ${path}`);
  }
  return parsed;
}

function writeJson(path: string, value: JsonObject): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function ensureAgentMap(config: JsonObject): JsonObject {
  const agentCandidate = config.agent;
  if (isObject(agentCandidate)) {
    return agentCandidate;
  }
  const agentsCandidate = config.agents;
  if (isObject(agentsCandidate)) {
    config.agent = agentsCandidate;
    return agentsCandidate;
  }
  const created: JsonObject = {};
  config.agent = created;
  return created;
}

function ensurePluginArray(config: JsonObject): unknown[] {
  const candidate = config.plugin;
  if (Array.isArray(candidate)) {
    return [...candidate];
  }
  const created: unknown[] = [];
  config.plugin = created;
  return created;
}

function ensureMcpMap(config: JsonObject): JsonObject {
  const candidate = config.mcp;
  if (isObject(candidate)) {
    return candidate;
  }
  const created: JsonObject = {};
  config.mcp = created;
  return created;
}

function removeLegacySequentialThinkingAlias(opencodeConfig: JsonObject): void {
  const mcpMap = ensureMcpMap(opencodeConfig);
  // 이전 버전에서는 "sequential-thinking" 이라는 키 이름으로 사용했었음.
  // 동일한 MCP가 "sequential-thinking", "sequential_thinking" 두 개의 키로 중복 등록되는 현상(MCP 인스턴스 2개)을 방지.
  if (Object.prototype.hasOwnProperty.call(mcpMap, "sequential-thinking")) {
    delete mcpMap["sequential-thinking"];
  }
}

function removeLegacyOrchestratorAgents(opencodeConfig: JsonObject): void {
  const agentMap = ensureAgentMap(opencodeConfig);
  for (const key of LEGACY_ORCHESTRATOR_AGENTS) {
    if (Object.prototype.hasOwnProperty.call(agentMap, key)) {
      delete agentMap[key];
    }
  }
}

function enforceAegisAgentModes(opencodeConfig: JsonObject): void {
  const agentMap = ensureAgentMap(opencodeConfig);
  const aegisCandidate = agentMap[DEFAULT_AEGIS_AGENT];
  const aegisProfile: JsonObject = isObject(aegisCandidate) ? aegisCandidate : {};
  agentMap[DEFAULT_AEGIS_AGENT] = {
    ...aegisProfile,
    mode: "primary",
  };

  for (const name of BUILTIN_PRIMARY_ORCHESTRATOR_AGENTS) {
    const candidate = agentMap[name];
    const profile: JsonObject = isObject(candidate) ? candidate : {};
    agentMap[name] = {
      ...profile,
      mode: "subagent",
      hidden: true,
    };
  }
}

function ensureProviderMap(config: JsonObject): JsonObject {
  const candidate = config.provider;
  if (isObject(candidate)) {
    return candidate;
  }
  const created: JsonObject = {};
  config.provider = created;
  return created;
}

function mergeMissingFields(target: JsonObject, source: JsonObject): JsonObject {
  const merged = cloneJsonObject(target);
  for (const [key, value] of Object.entries(source)) {
    if (!Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[key] = isObject(value) ? cloneJsonObject(value) : value;
      continue;
    }
    const current = merged[key];
    if (isObject(current) && isObject(value)) {
      merged[key] = mergeMissingFields(current, value);
    }
  }
  return merged;
}

function rewriteLegacyModelKeys(models: JsonObject, remap: Record<string, string>): void {
  for (const [legacyID, nextID] of Object.entries(remap)) {
    if (!Object.prototype.hasOwnProperty.call(models, legacyID)) {
      continue;
    }
    const legacyValue = models[legacyID];
    if (!Object.prototype.hasOwnProperty.call(models, nextID)) {
      models[nextID] = isObject(legacyValue) ? cloneJsonObject(legacyValue) : legacyValue;
    } else if (isObject(models[nextID]) && isObject(legacyValue)) {
      models[nextID] = mergeMissingFields(models[nextID] as JsonObject, legacyValue);
    }
    delete models[legacyID];
  }
}

function normalizeLegacyModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return "";
  }
  return LEGACY_MODEL_ID_REMAP[trimmed] ?? trimmed;
}

function inferProviderForLegacyModelId(modelId: string): "google" | "anthropic" | "openai" | "" {
  if (!modelId) {
    return "";
  }
  if (modelId.startsWith("gemini-") || modelId.startsWith("antigravity-gemini-")) {
    return "google";
  }
  if (modelId.startsWith("claude-")) {
    return "anthropic";
  }
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3") || modelId.startsWith("o4")) {
    return "openai";
  }
  return "";
}

function normalizeModelReference(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return "";
  }

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) {
    const normalizedModelId = normalizeLegacyModelId(trimmed);
    const inferredProvider = inferProviderForLegacyModelId(normalizedModelId);
    return inferredProvider ? `${inferredProvider}/${normalizedModelId}` : normalizedModelId;
  }

  const rawProviderId = trimmed.slice(0, slashIndex).trim().toLowerCase();
  const normalizedModelId = normalizeLegacyModelId(trimmed.slice(slashIndex + 1));
  if (!normalizedModelId) {
    return trimmed;
  }
  if (rawProviderId === "model_cli") {
    const inferredProvider = inferProviderForLegacyModelId(normalizedModelId);
    return inferredProvider ? `${inferredProvider}/${normalizedModelId}` : trimmed;
  }
  if (rawProviderId === "gemini") {
    return `google/${normalizedModelId}`;
  }
  return `${rawProviderId}/${normalizedModelId}`;
}

function ensureProviderModelsMap(providerMap: JsonObject, providerId: string): JsonObject {
  const providerCandidate = providerMap[providerId];
  const provider: JsonObject = isObject(providerCandidate) ? providerCandidate : {};
  providerMap[providerId] = provider;
  const modelsCandidate = provider.models;
  const models: JsonObject = isObject(modelsCandidate) ? modelsCandidate : {};
  provider.models = models;
  return models;
}

function upsertProviderModel(models: JsonObject, modelId: string, modelConfig: unknown): void {
  if (!Object.prototype.hasOwnProperty.call(models, modelId)) {
    models[modelId] = isObject(modelConfig) ? cloneJsonObject(modelConfig) : modelConfig;
    return;
  }
  if (isObject(models[modelId]) && isObject(modelConfig)) {
    models[modelId] = mergeMissingFields(models[modelId] as JsonObject, modelConfig);
  }
}

function ensureGoogleProviderCatalog(opencodeConfig: JsonObject): void {
  const providerMap = ensureProviderMap(opencodeConfig);
  const googleCandidate = providerMap.google;
  const googleProvider: JsonObject = isObject(googleCandidate) ? googleCandidate : {};
  const legacyGeminiCliProvider = isObject(providerMap.gemini_cli) ? (providerMap.gemini_cli as JsonObject) : null;
  providerMap.google = googleProvider;

  if (typeof googleProvider.name !== "string" || googleProvider.name.trim().length === 0) {
    googleProvider.name = DEFAULT_GOOGLE_PROVIDER_NAME;
  }
  if (typeof googleProvider.npm !== "string" || googleProvider.npm.trim().length === 0) {
    googleProvider.npm = DEFAULT_GOOGLE_PROVIDER_NPM;
  }

  const modelsCandidate = googleProvider.models;
  const models: JsonObject = isObject(modelsCandidate) ? modelsCandidate : {};
  googleProvider.models = models;
  const legacyModels =
    legacyGeminiCliProvider && isObject(legacyGeminiCliProvider.models)
      ? (legacyGeminiCliProvider.models as JsonObject)
      : {};

  rewriteLegacyModelKeys(models, {
    "gemini-3.1-pro": "gemini-3.1-pro-preview",
    "gemini-3.1-flash": "gemini-3.1-flash-lite-preview",
  });

  normalizeAntigravityModelKeys(models);

  const mergeDefaults = (defaults: JsonObject, existing: JsonObject): JsonObject => {
    const merged: JsonObject = cloneJsonObject(defaults);
    for (const [key, value] of Object.entries(existing)) {
      const current = merged[key];
      if (isObject(current) && isObject(value)) {
        merged[key] = mergeDefaults(current, value);
      } else {
        merged[key] = value;
      }
    }
    return merged;
  };

  for (const [modelID, modelDefaults] of Object.entries(DEFAULT_GOOGLE_PROVIDER_MODELS)) {
    const existingModel = isObject(models[modelID])
      ? (models[modelID] as JsonObject)
      : isObject(legacyModels[modelID])
        ? (legacyModels[modelID] as JsonObject)
        : {};
    models[modelID] = mergeDefaults(modelDefaults, existingModel);
  }
}

function normalizeAntigravityModelKeys(models: JsonObject): void {
  const remapSuffixes = new Set(["high", "low"]);
  for (const [key, value] of Object.entries(models)) {
    if (!key.startsWith("antigravity-gemini-")) {
      continue;
    }
    const parts = key.split("-");
    const suffix = parts[parts.length - 1];
    if (!suffix || !remapSuffixes.has(suffix)) {
      continue;
    }
    const baseKey = parts.slice(0, -1).join("-");
    if (!isObject(models[baseKey])) {
      models[baseKey] = isObject(value) ? cloneJsonObject(value) : value;
    }
    delete models[key];
  }

  for (const baseKey of ["antigravity-gemini-3-pro", "antigravity-gemini-3-flash"]) {
    const candidate = models[baseKey];
    if (isObject(candidate) && Object.prototype.hasOwnProperty.call(candidate, "variants")) {
      delete (candidate as Record<string, unknown>).variants;
    }
  }
}

function ensureOpenAIProviderCatalog(opencodeConfig: JsonObject): void {
  const providerMap = ensureProviderMap(opencodeConfig);
  const openAICandidate = providerMap.openai;
  const openAIProvider: JsonObject = isObject(openAICandidate) ? openAICandidate : {};
  providerMap.openai = openAIProvider;

  if (typeof openAIProvider.name !== "string" || openAIProvider.name.trim().length === 0) {
    openAIProvider.name = DEFAULT_OPENAI_PROVIDER_NAME;
  }

  if (!isObject(openAIProvider.options)) {
    openAIProvider.options = cloneJsonObject(DEFAULT_OPENAI_PROVIDER_OPTIONS);
  }

  const modelsCandidate = openAIProvider.models;
  const models: JsonObject = isObject(modelsCandidate) ? modelsCandidate : {};
  openAIProvider.models = models;

  for (const [modelID, modelDefaults] of Object.entries(DEFAULT_OPENAI_PROVIDER_MODELS)) {
    if (!isObject(models[modelID])) {
      models[modelID] = cloneJsonObject(modelDefaults);
    }
  }
}

function ensureAnthropicProviderCatalog(opencodeConfig: JsonObject): void {
  const providerMap = ensureProviderMap(opencodeConfig);
  const anthropicCandidate = providerMap.anthropic;
  const anthropicProvider: JsonObject = isObject(anthropicCandidate) ? anthropicCandidate : {};
  providerMap.anthropic = anthropicProvider;

  if (typeof anthropicProvider.name !== "string" || anthropicProvider.name.trim().length === 0) {
    anthropicProvider.name = DEFAULT_ANTHROPIC_PROVIDER_NAME;
  }
  if (typeof anthropicProvider.npm !== "string" || anthropicProvider.npm.trim().length === 0) {
    anthropicProvider.npm = DEFAULT_ANTHROPIC_PROVIDER_NPM;
  }

  const modelsCandidate = anthropicProvider.models;
  const models: JsonObject = isObject(modelsCandidate) ? modelsCandidate : {};
  anthropicProvider.models = models;

  rewriteLegacyModelKeys(models, {
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-haiku-4.5": "claude-haiku-4-5",
  });

  for (const [modelID, modelDefaults] of Object.entries(DEFAULT_ANTHROPIC_PROVIDER_MODELS)) {
    if (!isObject(models[modelID])) {
      models[modelID] = cloneJsonObject(modelDefaults);
    }
  }
}

function migrateLegacyGeminiCliProvider(opencodeConfig: JsonObject): void {
  const providerMap = ensureProviderMap(opencodeConfig);
  const legacyCandidate = providerMap.gemini_cli;
  if (!isObject(legacyCandidate)) {
    return;
  }

  delete providerMap.gemini_cli;
  const legacy = legacyCandidate as JsonObject;
  const googleCandidate = providerMap.google;
  const googleProvider: JsonObject = isObject(googleCandidate) ? googleCandidate : {};
  providerMap.google = googleProvider;

  if (typeof googleProvider.name !== "string" || googleProvider.name.trim().length === 0) {
    googleProvider.name = DEFAULT_GOOGLE_PROVIDER_NAME;
  }
  if (typeof googleProvider.npm !== "string" || googleProvider.npm.trim().length === 0) {
    googleProvider.npm = DEFAULT_GOOGLE_PROVIDER_NPM;
  }

  const legacyModels = isObject(legacy.models) ? (legacy.models as JsonObject) : {};
  const modelsCandidate = googleProvider.models;
  const models: JsonObject = isObject(modelsCandidate) ? modelsCandidate : {};
  googleProvider.models = models;

  for (const [modelId, modelConfig] of Object.entries(legacyModels)) {
    if (!isObject(models[modelId])) {
      models[modelId] = isObject(modelConfig) ? cloneJsonObject(modelConfig) : modelConfig;
    }
  }
}

function migrateLegacyModelCliProvider(opencodeConfig: JsonObject): void {
  const providerMap = ensureProviderMap(opencodeConfig);
  const legacyCandidate = providerMap.model_cli;
  if (!isObject(legacyCandidate)) {
    return;
  }

  delete providerMap.model_cli;
  const legacyModels = isObject(legacyCandidate.models) ? (legacyCandidate.models as JsonObject) : {};
  for (const [modelId, modelConfig] of Object.entries(legacyModels)) {
    const normalizedModelId = normalizeLegacyModelId(modelId);
    const providerId = inferProviderForLegacyModelId(normalizedModelId);
    if (!providerId) {
      continue;
    }
    const models = ensureProviderModelsMap(providerMap, providerId);
    upsertProviderModel(models, normalizedModelId, modelConfig);
  }
}


export interface ResolveLatestPackageVersionOptions {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export async function resolveLatestPackageVersion(
  packageName: string,
  options?: ResolveLatestPackageVersionOptions
): Promise<string | null> {
  const pkg = packageName.trim();
  if (!pkg) return null;

  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? VERSION_RESOLVE_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const encoded = encodeURIComponent(pkg);
    const res = await fetchImpl(`${NPM_REGISTRY_LATEST_PREFIX}${encoded}${NPM_LATEST_SUFFIX}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    if (typeof data.version !== "string") return null;
    const version = data.version.trim();
    return version.length > 0 ? version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveAntigravityAuthPluginEntry(
  options?: ResolveLatestPackageVersionOptions
): Promise<string> {
  const version = await resolveLatestPackageVersion(ANTIGRAVITY_AUTH_PACKAGE_NAME, options);
  if (!version) {
    return REQUIRED_ANTIGRAVITY_AUTH_PLUGIN;
  }
  return `${ANTIGRAVITY_AUTH_PACKAGE_NAME}@${version}`;
}

export async function resolveGeminiAuthPluginEntry(
  options?: ResolveLatestPackageVersionOptions
): Promise<string> {
  const version = await resolveLatestPackageVersion(GEMINI_AUTH_PACKAGE_NAME, options);
  if (!version) {
    return REQUIRED_GEMINI_AUTH_PLUGIN;
  }
  return `${GEMINI_AUTH_PACKAGE_NAME}@${version}`;
}

export async function resolveClaudeAuthPluginEntry(
  options?: ResolveLatestPackageVersionOptions & { environment?: NodeJS.ProcessEnv }
): Promise<string> {
  const env = options?.environment ?? process.env;
  const explicit = typeof env.AEGIS_CLAUDE_AUTH_PLUGIN_ENTRY === "string"
    ? env.AEGIS_CLAUDE_AUTH_PLUGIN_ENTRY.trim()
    : "";
  if (explicit) {
    return explicit;
  }
  const version = await resolveLatestPackageVersion(CLAUDE_AUTH_PACKAGE_NAME, options);
  if (!version) {
    return REQUIRED_CLAUDE_AUTH_PLUGIN;
  }
  return `${CLAUDE_AUTH_PACKAGE_NAME}@${version}`;
}

export async function resolveOpenAICodexAuthPluginEntry(
  options?: ResolveLatestPackageVersionOptions
): Promise<string> {
  const version = await resolveLatestPackageVersion(OPENAI_CODEX_AUTH_PACKAGE_NAME, options);
  if (!version) {
    return REQUIRED_OPENAI_CODEX_AUTH_PLUGIN;
  }
  return `${OPENAI_CODEX_AUTH_PACKAGE_NAME}@${version}`;
}

export function resolveOpencodeDir(environment: NodeJS.ProcessEnv = process.env): string {
  const candidates = resolveOpencodeDirCandidates(environment);

  for (const candidate of candidates) {
    if (hasAegisInstallMarker(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (hasOpencodeConfigFile(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  throw new Error("Cannot resolve OpenCode config directory. Set OPENCODE_CONFIG_DIR, XDG_CONFIG_HOME, HOME, or APPDATA.");
}

export function resolveOpencodeConfigPath(opencodeDir: string): string {
  return resolveOpencodeConfigPathInDir(opencodeDir);
}

function mergeAegisConfig(existing: JsonObject): JsonObject {
  const merged: JsonObject = {
    ...DEFAULT_AEGIS_CONFIG,
    ...existing,
  };

  const existingParallel = isObject(existing.parallel) ? existing.parallel : {};
  merged.parallel = {
    ...(DEFAULT_AEGIS_CONFIG.parallel as JsonObject),
    ...existingParallel,
  };

  const existingAutoDispatch = isObject(existing.auto_dispatch) ? existing.auto_dispatch : {};
  merged.auto_dispatch = {
    ...(DEFAULT_AEGIS_CONFIG.auto_dispatch as JsonObject),
    ...existingAutoDispatch,
  };

  const existingCommentChecker = isObject(existing.comment_checker) ? existing.comment_checker : {};
  merged.comment_checker = {
    ...(DEFAULT_AEGIS_CONFIG.comment_checker as JsonObject),
    ...existingCommentChecker,
  };

  const existingRulesInjector = isObject(existing.rules_injector) ? existing.rules_injector : {};
  merged.rules_injector = {
    ...(DEFAULT_AEGIS_CONFIG.rules_injector as JsonObject),
    ...existingRulesInjector,
  };

  const existingRecovery = isObject(existing.recovery) ? existing.recovery : {};
  merged.recovery = {
    ...(DEFAULT_AEGIS_CONFIG.recovery as JsonObject),
    ...existingRecovery,
  };

  const existingInteractive = isObject(existing.interactive) ? existing.interactive : {};
  merged.interactive = {
    ...(DEFAULT_AEGIS_CONFIG.interactive as JsonObject),
    ...existingInteractive,
  };

  const existingTuiNotifications = isObject(existing.tui_notifications) ? existing.tui_notifications : {};
  merged.tui_notifications = {
    ...(DEFAULT_AEGIS_CONFIG.tui_notifications as JsonObject),
    ...existingTuiNotifications,
  };

  const existingDynamicModel = isObject(existing.dynamic_model) ? existing.dynamic_model : {};
  merged.dynamic_model = {
    ...(DEFAULT_AEGIS_CONFIG.dynamic_model as JsonObject),
    ...existingDynamicModel,
  };

  const defaultRoleProfiles = isObject((DEFAULT_AEGIS_CONFIG.dynamic_model as JsonObject).role_profiles)
    ? ((DEFAULT_AEGIS_CONFIG.dynamic_model as JsonObject).role_profiles as JsonObject)
    : {};
  const existingRoleProfiles = isObject(existingDynamicModel.role_profiles)
    ? (existingDynamicModel.role_profiles as JsonObject)
    : {};
  const mergedRoleProfiles: JsonObject = {
    ...defaultRoleProfiles,
    ...existingRoleProfiles,
  };

  for (const lane of ["execution", "planning", "exploration"] as const) {
    const defaultProfile = isObject(defaultRoleProfiles[lane]) ? (defaultRoleProfiles[lane] as JsonObject) : {};
    const existingProfile = isObject(existingRoleProfiles[lane]) ? cloneJsonObject(existingRoleProfiles[lane] as JsonObject) : {};
    if (typeof existingProfile.model === "string") {
      existingProfile.model = normalizeModelReference(existingProfile.model);
    }
    mergedRoleProfiles[lane] = {
      ...defaultProfile,
      ...existingProfile,
    };
  }

  (merged.dynamic_model as JsonObject).role_profiles = mergedRoleProfiles;

  // Merge agent_model_overrides: preserve all user-defined entries
  const defaultOverrides = isObject((DEFAULT_AEGIS_CONFIG.dynamic_model as JsonObject).agent_model_overrides)
    ? ((DEFAULT_AEGIS_CONFIG.dynamic_model as JsonObject).agent_model_overrides as JsonObject)
    : {};
  const existingOverrides = isObject(existingDynamicModel.agent_model_overrides)
    ? (existingDynamicModel.agent_model_overrides as JsonObject)
    : {};
  const mergedOverrides: JsonObject = { ...defaultOverrides };
  for (const [agentName, entry] of Object.entries(existingOverrides)) {
    if (isObject(entry)) {
      const model = typeof entry.model === "string" ? normalizeModelReference(entry.model) : "";
      const variant = typeof entry.variant === "string" ? entry.variant : "";
      if (model) {
        mergedOverrides[agentName] = { model, variant };
      }
    }
  }
  (merged.dynamic_model as JsonObject).agent_model_overrides = mergedOverrides;

  return merged;
}

function hasPluginEntry(pluginArray: unknown[], pluginEntry: string): boolean {
  return pluginArray.some((item) => typeof item === "string" && item === pluginEntry);
}

function hasPackagePlugin(pluginArray: unknown[], packageName: string): boolean {
  return pluginArray.some((item) => matchesPackagePluginEntry(item, packageName));
}

function matchesPackagePluginEntry(item: unknown, packageName: string): boolean {
  if (typeof item !== "string") {
    return false;
  }
  const normalized = item.trim();
  if (normalized === packageName || normalized.startsWith(`${packageName}@`)) {
    return true;
  }
  const lower = normalized.toLowerCase();
  const lowerPkg = packageName.toLowerCase();
  const sep1 = `/${lowerPkg}/`;
  const sep2 = `/${lowerPkg}`;
  return lower.includes(sep1) || lower.endsWith(sep2);
}

/**
 * isOhMyAegisPluginEntry returns true for any plugin string that refers to the
 * oh-my-aegis package regardless of version tag or absolute install path.
 * Matched patterns:
 *   - "oh-my-aegis"                   (bare package name)
 *   - "oh-my-aegis@<tag>"             (versioned npm reference)
 *   - ".../node_modules/oh-my-aegis/..." (absolute path inside a node_modules tree)
 *   - any path containing "/oh-my-aegis" as a path segment
 */
function isOhMyAegisPluginEntry(item: unknown, packageName: string): boolean {
  return matchesPackagePluginEntry(item, packageName);
}

/**
 * replaceOrAddPluginEntry replaces the first existing oh-my-aegis plugin entry
 * (matched by isOhMyAegisPluginEntry) with newEntry and removes any additional
 * duplicates. If no existing entry is found, newEntry is appended.
 *
 * This ensures that running `oh-my-aegis install` after
 * `npm install -g oh-my-aegis@latest` correctly updates the registered path
 * rather than accumulating stale entries.
 */
function replaceOrAddPluginEntry(pluginArray: unknown[], newEntry: string, packageName: string): unknown[] {
  // If the exact entry already exists, nothing to do
  if (hasPluginEntry(pluginArray, newEntry)) {
    // Still remove any stale duplicates for the same package
    return pluginArray.filter((item) => !isOhMyAegisPluginEntry(item, packageName) || item === newEntry);
  }

  let replaced = false;
  const result: unknown[] = [];
  for (const item of pluginArray) {
    if (isOhMyAegisPluginEntry(item, packageName)) {
      if (!replaced) {
        // Replace first occurrence with the new entry
        result.push(newEntry);
        replaced = true;
      }
      // Drop any additional stale occurrences
    } else {
      result.push(item);
    }
  }
  if (!replaced) {
    result.push(newEntry);
  }
  return result;
}

function replaceOrAddPackagePluginEntry(pluginArray: unknown[], newEntry: string, packageName: string): unknown[] {
  if (hasPluginEntry(pluginArray, newEntry)) {
    return pluginArray.filter((item) => !matchesPackagePluginEntry(item, packageName) || item === newEntry);
  }

  let replaced = false;
  const result: unknown[] = [];
  for (const item of pluginArray) {
    if (matchesPackagePluginEntry(item, packageName)) {
      if (!replaced) {
        result.push(newEntry);
        replaced = true;
      }
      continue;
    }
    result.push(item);
  }

  if (!replaced) {
    result.push(newEntry);
  }

  return result;
}

function toHiddenSubagent(entry: JsonObject): JsonObject {
  return {
    ...entry,
    mode: "subagent",
    hidden: true,
  };
}

function applyRequiredAgents(
  opencodeConfig: JsonObject,
  parsedAegisConfig: OrchestratorConfig,
  options?: { environment?: NodeJS.ProcessEnv; providerAvailability?: ProviderAvailabilityOverrides }
): string[] {
  const agentMap = ensureAgentMap(opencodeConfig);
  const requiredSubagents = requiredDispatchSubagents(parsedAegisConfig);
  requiredSubagents.push(
    parsedAegisConfig.failover.map.explore,
    parsedAegisConfig.failover.map.librarian,
    parsedAegisConfig.failover.map.oracle
  );

  const env = options?.environment ?? process.env;
  const providerAvailability = options?.providerAvailability ?? {};

  const addedAgents: string[] = [];
  const agentOverrides = parsedAegisConfig.dynamic_model.agent_model_overrides;

  for (const name of new Set(requiredSubagents)) {
    const existing = agentMap[name];
    const override = agentOverrides[name];

    if (isObject(existing)) {
      const existingModel = typeof existing.model === "string" ? existing.model.trim() : "";
      const shouldMigrateExistingModel =
        existingModel.length > 0 &&
        !isModelAvailableByEnv(existingModel, env, providerAvailability);

      if (override || shouldMigrateExistingModel) {
        const profile = override
          ? { model: override.model, variant: override.variant ?? DEFAULT_AGENT_VARIANT }
          : defaultProfileForAgentLane(name, parsedAegisConfig.dynamic_model.role_profiles);
        const migrated: JsonObject = {
          ...existing,
          model: resolveModelByEnvironment(profile.model, env, providerAvailability),
          variant: profile.variant ?? DEFAULT_AGENT_VARIANT,
        };
        if (AGENT_PROMPTS[name] && !migrated.prompt) {
          migrated.prompt = AGENT_PROMPTS[name];
        }
        if (AGENT_PERMISSIONS[name]) {
          migrated.permission = AGENT_PERMISSIONS[name];
        }
        agentMap[name] = toHiddenSubagent(migrated);
      } else {
        agentMap[name] = toHiddenSubagent(existing);
      }
      continue;
    }

    const profile = override
      ? { model: override.model, variant: override.variant ?? DEFAULT_AGENT_VARIANT }
      : defaultProfileForAgentLane(name, parsedAegisConfig.dynamic_model.role_profiles);
    const agentEntry: JsonObject = {
      ...profile,
      model: resolveModelByEnvironment(profile.model, env, providerAvailability),
    };
    if (AGENT_PROMPTS[name]) {
      agentEntry.prompt = AGENT_PROMPTS[name];
    }
    if (AGENT_PERMISSIONS[name]) {
      agentEntry.permission = AGENT_PERMISSIONS[name];
    }
    agentMap[name] = toHiddenSubagent(agentEntry);
    addedAgents.push(name);
  }
  return addedAgents;
}

function applyBuiltinMcps(opencodeConfig: JsonObject, parsedAegisConfig: OrchestratorConfig, opencodeDir: string): string[] {
  if (!parsedAegisConfig.enable_builtin_mcps) {
    return [];
  }

  const mcpMap = ensureMcpMap(opencodeConfig);
  const builtinMcps = createBuiltinMcps({
    projectDir: opencodeDir,
    disabledMcps: parsedAegisConfig.disabled_mcps,
    memoryStorageDir: parsedAegisConfig.memory.storage_dir,
  });
  for (const [name, serverConfig] of Object.entries(builtinMcps)) {
    if (!isObject(mcpMap[name])) {
      mcpMap[name] = serverConfig;
    }
  }
  return Object.keys(builtinMcps);
}

export function applyAegisConfig(options: ApplyAegisConfigOptions): ApplyAegisConfigResult {
  const pluginEntry = options.pluginEntry.trim();
  if (!pluginEntry) {
    throw new Error("pluginEntry is required.");
  }

  const backupExistingConfig = options.backupExistingConfig ?? true;
  const opencodeDir = options.opencodeDirOverride ?? resolveOpencodeDir(options.environment);
  const opencodePath = resolveOpencodeConfigPath(opencodeDir);
  const aegisPath = join(opencodeDir, "oh-my-Aegis.json");
  const ensureClaudeAuthPlugin = options.ensureClaudeAuthPlugin ?? false;
  const ensureGeminiAuthPlugin = options.ensureGeminiAuthPlugin ?? true;
  const ensureAntigravityAuthPlugin = options.ensureAntigravityAuthPlugin ?? true;
  const ensureOpenAICodexAuthPlugin = options.ensureOpenAICodexAuthPlugin ?? true;
  const ensureGoogleProviderCatalogEnabled = options.ensureGoogleProviderCatalog ?? true;
  const ensureOpenAIProviderCatalogEnabled = options.ensureOpenAIProviderCatalog ?? true;
  const ensureAnthropicProviderCatalogEnabled = options.ensureAnthropicProviderCatalog ?? true;

  ensureDir(opencodeDir);

  const opencodeConfig = readJson(opencodePath);
  const aegisExisting = readJson(aegisPath);
  const mergedAegis = mergeAegisConfig(aegisExisting);
  const parsedAegisConfig = OrchestratorConfigSchema.parse(mergedAegis);

  let backupPath: string | null = null;
  if (backupExistingConfig && existsSync(opencodePath)) {
    const suffix = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = `${opencodePath}.bak.${suffix}`;
    copyFileSync(opencodePath, backupPath);
  }

  const rawPluginArray = ensurePluginArray(opencodeConfig);
  const pluginArray = replaceOrAddPluginEntry(rawPluginArray, pluginEntry, "oh-my-aegis").filter((entry) => {
    if (ensureAntigravityAuthPlugin) {
      return true;
    }
    if (typeof entry !== "string") {
      return true;
    }
    return !(entry === ANTIGRAVITY_AUTH_PACKAGE_NAME || entry.startsWith(`${ANTIGRAVITY_AUTH_PACKAGE_NAME}@`));
  });
  const claudePluginEntry = (options.claudeAuthPluginEntry ?? "").trim();
  const geminiPluginEntry = (options.geminiAuthPluginEntry ?? REQUIRED_GEMINI_AUTH_PLUGIN).trim();
  const antigravityPluginEntry = (options.antigravityAuthPluginEntry ?? REQUIRED_ANTIGRAVITY_AUTH_PLUGIN).trim();
  const openAICodexPluginEntry = (options.openAICodexAuthPluginEntry ?? REQUIRED_OPENAI_CODEX_AUTH_PLUGIN).trim();
  if (ensureClaudeAuthPlugin && claudePluginEntry) {
    const nextPluginArray = replaceOrAddPackagePluginEntry(pluginArray, claudePluginEntry, CLAUDE_AUTH_PACKAGE_NAME);
    pluginArray.length = 0;
    pluginArray.push(...nextPluginArray);
  }
  if (ensureGeminiAuthPlugin && !hasPackagePlugin(pluginArray, GEMINI_AUTH_PACKAGE_NAME)) {
    pluginArray.push(geminiPluginEntry);
  }
  if (ensureAntigravityAuthPlugin && !hasPackagePlugin(pluginArray, ANTIGRAVITY_AUTH_PACKAGE_NAME)) {
    pluginArray.push(antigravityPluginEntry);
  }
  if (ensureOpenAICodexAuthPlugin && !hasPackagePlugin(pluginArray, OPENAI_CODEX_AUTH_PACKAGE_NAME)) {
    pluginArray.push(openAICodexPluginEntry);
  }
  opencodeConfig.plugin = [...pluginArray];

  removeLegacySequentialThinkingAlias(opencodeConfig);
  removeLegacyOrchestratorAgents(opencodeConfig);
  migrateLegacyGeminiCliProvider(opencodeConfig);
  migrateLegacyModelCliProvider(opencodeConfig);

  const providerAvailability: ProviderAvailabilityOverrides = {};
  if (hasPackagePlugin(pluginArray, CLAUDE_AUTH_PACKAGE_NAME)) {
    providerAvailability.anthropic = true;
  }

  const ensuredBuiltinMcps = applyBuiltinMcps(opencodeConfig, parsedAegisConfig, opencodeDir);
  const addedAgents = applyRequiredAgents(opencodeConfig, parsedAegisConfig, {
    environment: options.environment,
    providerAvailability,
  });
  enforceAegisAgentModes(opencodeConfig);
  if (ensureGoogleProviderCatalogEnabled) {
    ensureGoogleProviderCatalog(opencodeConfig);
  }
  if (ensureOpenAIProviderCatalogEnabled) {
    ensureOpenAIProviderCatalog(opencodeConfig);
  }
  if (ensureAnthropicProviderCatalogEnabled) {
    ensureAnthropicProviderCatalog(opencodeConfig);
  }
  opencodeConfig.default_agent = DEFAULT_AEGIS_AGENT;

  writeJson(opencodePath, opencodeConfig);
  writeJson(aegisPath, parsedAegisConfig as unknown as JsonObject);

  return {
    opencodePath,
    aegisPath,
    backupPath,
    pluginEntry,
    addedAgents,
    ensuredBuiltinMcps,
  };
}
