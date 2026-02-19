import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OrchestratorConfig } from "../config/schema";
import { OrchestratorConfigSchema } from "../config/schema";
import { createBuiltinMcps } from "../mcp";
import { requiredDispatchSubagents } from "../orchestration/task-dispatch";
import { generateVariantEntries } from "../orchestration/model-health";
import { AGENT_OVERRIDES } from "./agent-overrides";

type JsonObject = Record<string, unknown>;

const DEFAULT_AGENT_MODEL = "openai/gpt-5.3-codex";
const DEFAULT_AGENT_VARIANT = "medium";
const REQUIRED_ANTIGRAVITY_AUTH_PLUGIN = "opencode-antigravity-auth@latest";
const ANTIGRAVITY_AUTH_PACKAGE_NAME = "opencode-antigravity-auth";
const REQUIRED_OPENAI_CODEX_AUTH_PLUGIN = "opencode-openai-codex-auth";
const OPENAI_CODEX_AUTH_PACKAGE_NAME = "opencode-openai-codex-auth";
const DEFAULT_GOOGLE_PROVIDER_NAME = "Google";
const DEFAULT_GOOGLE_PROVIDER_NPM = "@ai-sdk/google";
const DEFAULT_OPENAI_PROVIDER_NAME = "OpenAI";
const DEFAULT_OPENAI_PROVIDER_OPTIONS: JsonObject = {
  reasoningEffort: "medium",
  reasoningSummary: "auto",
  textVerbosity: "medium",
  include: ["reasoning.encrypted_content"],
  store: false,
};
const DEFAULT_GOOGLE_PROVIDER_MODELS: Record<string, JsonObject> = {
  "antigravity-gemini-3-pro": {
    name: "Gemini 3 Pro (Antigravity)",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_535,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
    variants: {
      low: {
        thinkingLevel: "low",
      },
      high: {
        thinkingLevel: "high",
      },
    },
  },
  "antigravity-gemini-3-flash": {
    name: "Gemini 3 Flash (Antigravity)",
    attachment: true,
    limit: {
      context: 1_048_576,
      output: 65_536,
    },
    modalities: {
      input: ["text", "image", "pdf"],
      output: ["text"],
    },
    variants: {
      minimal: {
        thinkingLevel: "minimal",
      },
      low: {
        thinkingLevel: "low",
      },
      medium: {
        thinkingLevel: "medium",
      },
      high: {
        thinkingLevel: "high",
      },
    },
  },
};
const DEFAULT_OPENAI_PROVIDER_MODELS: Record<string, JsonObject> = {
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
const NPM_REGISTRY_LATEST_PREFIX = "https://registry.npmjs.org/";
const NPM_LATEST_SUFFIX = "/latest";
const VERSION_RESOLVE_TIMEOUT_MS = 5_000;
const OPENCODE_JSON = "opencode.json";
const OPENCODE_JSONC = "opencode.jsonc";

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function providerIdFromModel(model: string): string {
  const trimmed = model.trim();
  const idx = trimmed.indexOf("/");
  if (idx === -1) return trimmed;
  return trimmed.slice(0, idx);
}

function isProviderAvailableByEnv(providerId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const has = (key: string) => {
    const v = env[key];
    return typeof v === "string" && v.trim().length > 0;
  };
  switch (providerId) {
    case "openai":
      return has("OPENAI_API_KEY");
    case "google":
      return has("GOOGLE_API_KEY") || has("GEMINI_API_KEY");
    case "anthropic":
      return has("ANTHROPIC_API_KEY");
    default:
      return false;
  }
}

function resolveModelByEnvironment(model: string, env: NodeJS.ProcessEnv = process.env): string {
  const providerId = providerIdFromModel(model);
  if (!providerId) return model;

  if (isProviderAvailableByEnv(providerId, env)) {
    return model;
  }

  const fallbackPool: string[] = [
    DEFAULT_AGENT_MODEL,
    "google/antigravity-gemini-3-flash",
    "google/antigravity-gemini-3-pro",
  ];
  for (const candidate of fallbackPool) {
    const candidateProvider = providerIdFromModel(candidate);
    if (candidateProvider && isProviderAvailableByEnv(candidateProvider, env)) {
      return candidate;
    }
  }

  return model;
}

export { AGENT_OVERRIDES };

const DEFAULT_AEGIS_CONFIG = {
  enabled: true,
  strict_readiness: true,
  enable_injection_logging: true,
  enforce_todo_single_in_progress: true,
  parallel: {
    queue_enabled: true,
    max_concurrent_per_provider: 2,
    provider_caps: {},
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
    edit_error_hint: true,
  },
  interactive: {
    enabled: false,
    enabled_in_ctf: true,
  },
  tui_notifications: {
    enabled: false,
    throttle_ms: 5_000,
  },
  claude_hooks: {
    enabled: false,
    max_runtime_ms: 5_000,
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
    risky_targets: ["WEB_API", "WEB3", "UNKNOWN"],
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
  antigravityAuthPluginEntry?: string;
  openAICodexAuthPluginEntry?: string;
  ensureAntigravityAuthPlugin?: boolean;
  ensureOpenAICodexAuthPlugin?: boolean;
  ensureGoogleProviderCatalog?: boolean;
  ensureOpenAIProviderCatalog?: boolean;
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

function stripJsonComments(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] as string;
    const next = i + 1 < raw.length ? (raw[i + 1] as string) : "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    out += ch;
  }

  return out;
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

function ensureProviderMap(config: JsonObject): JsonObject {
  const candidate = config.provider;
  if (isObject(candidate)) {
    return candidate;
  }
  const created: JsonObject = {};
  config.provider = created;
  return created;
}

function ensureGoogleProviderCatalog(opencodeConfig: JsonObject): void {
  const providerMap = ensureProviderMap(opencodeConfig);
  const googleCandidate = providerMap.google;
  const googleProvider: JsonObject = isObject(googleCandidate) ? googleCandidate : {};
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

  const legacyProHighModel = isObject(models["antigravity-gemini-3-pro-high"])
    ? (models["antigravity-gemini-3-pro-high"] as JsonObject)
    : null;
  const legacyProLowModel = isObject(models["antigravity-gemini-3-pro-low"])
    ? (models["antigravity-gemini-3-pro-low"] as JsonObject)
    : null;

  if (!isObject(models["antigravity-gemini-3-pro"]) && (legacyProHighModel || legacyProLowModel)) {
    const seed = cloneJsonObject(
      (legacyProHighModel ?? legacyProLowModel ?? DEFAULT_GOOGLE_PROVIDER_MODELS["antigravity-gemini-3-pro"]) as JsonObject
    );
    seed.name =
      typeof seed.name === "string" && seed.name.trim().length > 0
        ? seed.name.replace(/\s+(High|Low)\s*\(Antigravity\)/i, " (Antigravity)")
        : "Gemini 3 Pro (Antigravity)";
    delete seed.thinking;
    models["antigravity-gemini-3-pro"] = seed;
  }

  const proModel = isObject(models["antigravity-gemini-3-pro"])
    ? (models["antigravity-gemini-3-pro"] as JsonObject)
    : null;
  if (proModel) {
    const variants = isObject(proModel.variants) ? (proModel.variants as JsonObject) : {};
    if (!isObject(variants.low)) {
      variants.low = { thinkingLevel: "low" };
    }
    if (!isObject(variants.high)) {
      variants.high = { thinkingLevel: "high" };
    }
    proModel.variants = variants;
    delete proModel.thinking;
  }

  delete models["antigravity-gemini-3-pro-high"];
  delete models["antigravity-gemini-3-pro-low"];

  for (const [modelID, modelDefaults] of Object.entries(DEFAULT_GOOGLE_PROVIDER_MODELS)) {
    if (!isObject(models[modelID])) {
      models[modelID] = cloneJsonObject(modelDefaults);
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

export function resolveOpencodeDir(environment: NodeJS.ProcessEnv = process.env): string {
  const home = environment.HOME;
  const xdg = environment.XDG_CONFIG_HOME;
  const appData = environment.APPDATA;

  if (xdg && xdg.trim().length > 0) {
    return join(xdg, "opencode");
  }

  const candidates: string[] = [];
  if (home) {
    candidates.push(join(home, ".config", "opencode"));
  }
  if (appData) {
    candidates.push(join(appData, "opencode"));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  if (process.platform === "win32" && appData) {
    return join(appData, "opencode");
  }
  if (xdg) {
    return join(xdg, "opencode");
  }
  if (home) {
    return join(home, ".config", "opencode");
  }

  throw new Error("Cannot resolve OpenCode config directory. Set HOME or APPDATA.");
}

export function resolveOpencodeConfigPath(opencodeDir: string): string {
  const jsoncPath = join(opencodeDir, OPENCODE_JSONC);
  if (existsSync(jsoncPath)) {
    return jsoncPath;
  }
  const jsonPath = join(opencodeDir, OPENCODE_JSON);
  if (existsSync(jsonPath)) {
    return jsonPath;
  }
  return jsonPath;
}

function mergeAegisConfig(existing: JsonObject): JsonObject {
  const merged: JsonObject = {
    ...DEFAULT_AEGIS_CONFIG,
    ...existing,
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

  return merged;
}

function hasPluginEntry(pluginArray: unknown[], pluginEntry: string): boolean {
  return pluginArray.some((item) => typeof item === "string" && item === pluginEntry);
}

function hasPackagePlugin(pluginArray: unknown[], packageName: string): boolean {
  return pluginArray.some((item) => {
    if (typeof item !== "string") {
      return false;
    }
    return item === packageName || item.startsWith(`${packageName}@`);
  });
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
  options?: { environment?: NodeJS.ProcessEnv }
): string[] {
  const agentMap = ensureAgentMap(opencodeConfig);
  const requiredSubagents = requiredDispatchSubagents(parsedAegisConfig);
  requiredSubagents.push(
    parsedAegisConfig.failover.map.explore,
    parsedAegisConfig.failover.map.librarian,
    parsedAegisConfig.failover.map.oracle
  );

  const env = options?.environment ?? process.env;

  const addedAgents: string[] = [];
  for (const name of new Set(requiredSubagents)) {
    const existing = agentMap[name];
    if (isObject(existing)) {
      agentMap[name] = toHiddenSubagent(existing);
      continue;
    }
    const profile = AGENT_OVERRIDES[name] ?? {
      model: DEFAULT_AGENT_MODEL,
      variant: DEFAULT_AGENT_VARIANT,
    };
    agentMap[name] = toHiddenSubagent({
      ...profile,
      model: resolveModelByEnvironment(profile.model, env),
    });
    addedAgents.push(name);
  }

  if (parsedAegisConfig.dynamic_model.generate_variants) {
    for (const [baseName, baseProfile] of Object.entries(AGENT_OVERRIDES)) {
      const variants = generateVariantEntries(baseName, baseProfile);
      for (const v of variants) {
        const existing = agentMap[v.name];
        if (isObject(existing)) {
          agentMap[v.name] = toHiddenSubagent(existing);
          continue;
        }
        agentMap[v.name] = toHiddenSubagent({
          model: resolveModelByEnvironment(v.model, env),
          variant: v.variant,
        });
        addedAgents.push(v.name);
      }
    }
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
  const ensureAntigravityAuthPlugin = options.ensureAntigravityAuthPlugin ?? true;
  const ensureOpenAICodexAuthPlugin = options.ensureOpenAICodexAuthPlugin ?? true;
  const ensureGoogleProviderCatalogEnabled = options.ensureGoogleProviderCatalog ?? true;
  const ensureOpenAIProviderCatalogEnabled = options.ensureOpenAIProviderCatalog ?? true;

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

  const pluginArray = ensurePluginArray(opencodeConfig);
  if (!hasPluginEntry(pluginArray, pluginEntry)) {
    pluginArray.push(pluginEntry);
  }
  const antigravityPluginEntry = (options.antigravityAuthPluginEntry ?? REQUIRED_ANTIGRAVITY_AUTH_PLUGIN).trim();
  const openAICodexPluginEntry = (options.openAICodexAuthPluginEntry ?? REQUIRED_OPENAI_CODEX_AUTH_PLUGIN).trim();
  if (ensureAntigravityAuthPlugin && !hasPackagePlugin(pluginArray, ANTIGRAVITY_AUTH_PACKAGE_NAME)) {
    pluginArray.push(antigravityPluginEntry);
  }
  if (ensureOpenAICodexAuthPlugin && !hasPackagePlugin(pluginArray, OPENAI_CODEX_AUTH_PACKAGE_NAME)) {
    pluginArray.push(openAICodexPluginEntry);
  }
  opencodeConfig.plugin = pluginArray;

  const ensuredBuiltinMcps = applyBuiltinMcps(opencodeConfig, parsedAegisConfig, opencodeDir);
  const addedAgents = applyRequiredAgents(opencodeConfig, parsedAegisConfig, {
    environment: options.environment,
  });
  if (ensureGoogleProviderCatalogEnabled) {
    ensureGoogleProviderCatalog(opencodeConfig);
  }
  if (ensureOpenAIProviderCatalogEnabled) {
    ensureOpenAIProviderCatalog(opencodeConfig);
  }

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
