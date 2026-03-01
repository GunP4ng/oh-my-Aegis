import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OrchestratorConfig } from "../config/schema";
import { OrchestratorConfigSchema } from "../config/schema";
import { createBuiltinMcps } from "../mcp";
import { requiredDispatchSubagents } from "../orchestration/task-dispatch";
import { stripJsonComments } from "../utils/json";
import { AGENT_OVERRIDES } from "./agent-overrides";
import { AGENT_PROMPTS, AGENT_PERMISSIONS } from "../agents/domain-prompts";

type JsonObject = Record<string, unknown>;

const DEFAULT_AGENT_MODEL = "openai/gpt-5.3-codex";
const DEFAULT_AGENT_VARIANT = "medium";
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
};
const NPM_REGISTRY_LATEST_PREFIX = "https://registry.npmjs.org/";
const NPM_LATEST_SUFFIX = "/latest";
const VERSION_RESOLVE_TIMEOUT_MS = 5_000;
const OPENCODE_JSON = "opencode.json";
const OPENCODE_JSONC = "opencode.jsonc";
const AEGIS_CONFIG_JSON = "oh-my-Aegis.json";
const OPENCODE_CONFIG_DIR_ENV = "OPENCODE_CONFIG_DIR";
const DEFAULT_AEGIS_AGENT = "Aegis";
const LEGACY_ORCHESTRATOR_AGENTS = ["build", "Build", "prometheus", "Prometheus", "hephaestus", "Hephaestus"] as const;
const BUILTIN_PRIMARY_ORCHESTRATOR_AGENTS = ["build", "plan"] as const;

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
      return true;
    case "google":
      return has("GOOGLE_API_KEY") || has("GEMINI_API_KEY");
    case "anthropic":
      return has("ANTHROPIC_API_KEY");
    case "opencode":
      return has("OPENCODE_API_KEY");
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
    delete proModel.variants;
    delete proModel.thinking;
  }

  delete models["antigravity-gemini-3-pro-high"];
  delete models["antigravity-gemini-3-pro-low"];

  for (const [modelID, modelDefaults] of Object.entries(DEFAULT_GOOGLE_PROVIDER_MODELS)) {
    if (!isObject(models[modelID])) {
      models[modelID] = cloneJsonObject(modelDefaults);
    }
  }

  const flashModel = isObject(models["antigravity-gemini-3-flash"])
    ? (models["antigravity-gemini-3-flash"] as JsonObject)
    : null;
  if (flashModel) {
    delete flashModel.variants;
    delete flashModel.thinking;
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

  for (const [modelID, modelDefaults] of Object.entries(DEFAULT_ANTHROPIC_PROVIDER_MODELS)) {
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

export async function resolveOpenAICodexAuthPluginEntry(
  options?: ResolveLatestPackageVersionOptions
): Promise<string> {
  const version = await resolveLatestPackageVersion(OPENAI_CODEX_AUTH_PACKAGE_NAME, options);
  if (!version) {
    return REQUIRED_OPENAI_CODEX_AUTH_PLUGIN;
  }
  return `${OPENAI_CODEX_AUTH_PACKAGE_NAME}@${version}`;
}

function hasOpencodeConfigFile(opencodeDir: string): boolean {
  if (!opencodeDir) {
    return false;
  }
  return existsSync(join(opencodeDir, OPENCODE_JSONC)) || existsSync(join(opencodeDir, OPENCODE_JSON));
}

function readPluginEntries(opencodeDir: string): string[] {
  const candidates = [join(opencodeDir, OPENCODE_JSONC), join(opencodeDir, OPENCODE_JSON)];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      const raw = readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(stripJsonComments(raw)) as { plugin?: unknown };
      if (!Array.isArray(parsed.plugin)) {
        return [];
      }
      return parsed.plugin.filter((entry): entry is string => typeof entry === "string");
    } catch {
      return [];
    }
  }
  return [];
}

function hasAegisInstallMarker(opencodeDir: string): boolean {
  if (!opencodeDir) {
    return false;
  }
  if (existsSync(join(opencodeDir, AEGIS_CONFIG_JSON))) {
    return true;
  }
  const plugins = readPluginEntries(opencodeDir);
  return plugins.some((plugin) => {
    const normalized = plugin.trim();
    return (
      normalized === "oh-my-aegis" ||
      normalized.startsWith("oh-my-aegis@") ||
      normalized.endsWith("/oh-my-aegis") ||
      normalized.includes("/oh-my-aegis@")
    );
  });
}

function isOpencodeLeafDir(path: string): boolean {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  const tail = segments[segments.length - 1] ?? "";
  return tail.toLowerCase() === "opencode";
}

/**
 * ~/.config/ (or $XDG_CONFIG_HOME) 하위를 스캔해서
 * Aegis 마커가 있는 opencode 디렉토리를 자동 감지합니다.
 * 예: ~/.config/opencode-aegis/opencode, ~/.config/opencode-foo/opencode
 */
function scanConfigSubdirCandidates(configRoot: string): string[] {
  const results: string[] = [];
  if (!configRoot || !existsSync(configRoot)) {
    return results;
  }
  let entries: string[];
  try {
    entries = readdirSync(configRoot);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === "opencode") {
      // 기본 경로는 buildOpencodeDirCandidates에서 별도 처리
      continue;
    }
    const subdir = join(configRoot, entry);
    // subdir 자체가 opencode 디렉토리일 수 있음 (예: opencode-aegis 가 leaf인 경우)
    if (hasAegisInstallMarker(subdir) || hasOpencodeConfigFile(subdir)) {
      results.push(subdir);
    }
    // subdir/opencode 패턴 (예: opencode-aegis/opencode)
    const sub = join(subdir, "opencode");
    if (hasAegisInstallMarker(sub) || hasOpencodeConfigFile(sub)) {
      results.push(sub);
    }
  }
  return results;
}

function buildOpencodeDirCandidates(environment: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string | undefined): void => {
    const normalized = typeof candidate === "string" ? candidate.trim() : "";
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    out.push(normalized);
  };

  const opencodeConfigDir = typeof environment[OPENCODE_CONFIG_DIR_ENV] === "string" ? environment[OPENCODE_CONFIG_DIR_ENV] : "";
  const xdg = environment.XDG_CONFIG_HOME;
  const home = environment.HOME;
  const appData = environment.APPDATA;

  if (opencodeConfigDir && opencodeConfigDir.trim().length > 0) {
    const overrideRoot = opencodeConfigDir.trim();
    const overrideOpencodeDir = isOpencodeLeafDir(overrideRoot) ? overrideRoot : join(overrideRoot, "opencode");
    if (hasAegisInstallMarker(overrideRoot) || hasOpencodeConfigFile(overrideRoot)) {
      push(overrideRoot);
    }
    if (hasAegisInstallMarker(overrideOpencodeDir) || hasOpencodeConfigFile(overrideOpencodeDir)) {
      push(overrideOpencodeDir);
    }
    push(overrideOpencodeDir);
    push(overrideRoot);
  }

  // OPENCODE_CONFIG_DIR / XDG_CONFIG_HOME 가 없을 때,
  // ~/.config/ (또는 $XDG_CONFIG_HOME) 하위를 스캔해서
  // Aegis 마커가 있는 대체 경로를 자동 감지
  const configRoot = xdg && xdg.trim().length > 0
    ? xdg.trim()
    : home && home.trim().length > 0
      ? join(home.trim(), ".config")
      : "";

  if (configRoot) {
    // Aegis 마커가 있는 서브디렉 우선 — 기본 opencode 경로보다 앞에 삽입
    const aegisSubdirs = scanConfigSubdirCandidates(configRoot).filter(
      (d) => hasAegisInstallMarker(d)
    );
    for (const d of aegisSubdirs) {
      push(d);
    }
  }

  if (xdg && xdg.trim().length > 0) {
    push(join(xdg, "opencode"));
  }
  if (home && home.trim().length > 0) {
    push(join(home, ".config", "opencode"));
  }
  if (appData && appData.trim().length > 0) {
    push(join(appData, "opencode"));
  }

  return out;
}

export function resolveOpencodeDir(environment: NodeJS.ProcessEnv = process.env): string {
  const candidates = buildOpencodeDirCandidates(environment);

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
  if (typeof item !== "string") {
    return false;
  }
  const normalized = item.trim();
  if (normalized === packageName || normalized.startsWith(`${packageName}@`)) {
    return true;
  }
  // Match absolute paths that contain the package name as a path segment.
  // Use case-insensitive comparison to handle e.g. "oh-my-Aegis" vs "oh-my-aegis".
  const lower = normalized.toLowerCase();
  const lowerPkg = packageName.toLowerCase();
  const sep1 = `/${lowerPkg}/`;
  const sep2 = `/${lowerPkg}`;
  if (lower.includes(sep1) || lower.endsWith(sep2)) {
    return true;
  }
  return false;
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

function toHiddenSubagent(entry: JsonObject): JsonObject {
  return {
    ...entry,
    mode: "subagent",
    hidden: true,
  };
}

function isAntigravityModel(model: unknown): boolean {
  return typeof model === "string" && model.includes("antigravity");
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
      const existingModel = typeof existing.model === "string" ? existing.model.trim() : "";
      const shouldMigrateExistingModel =
        existingModel.length > 0 &&
        !isProviderAvailableByEnv(providerIdFromModel(existingModel), env);

      if (shouldMigrateExistingModel) {
        const profile = AGENT_OVERRIDES[name] ?? {
          model: DEFAULT_AGENT_MODEL,
          variant: DEFAULT_AGENT_VARIANT,
        };
        const migrated: JsonObject = {
          ...existing,
          model: resolveModelByEnvironment(profile.model, env),
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
    const profile = AGENT_OVERRIDES[name] ?? {
      model: DEFAULT_AGENT_MODEL,
      variant: DEFAULT_AGENT_VARIANT,
    };
    const agentEntry: JsonObject = {
      ...profile,
      model: resolveModelByEnvironment(profile.model, env),
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
  const pluginArray = replaceOrAddPluginEntry(rawPluginArray, pluginEntry, "oh-my-aegis");
  const antigravityPluginEntry = (options.antigravityAuthPluginEntry ?? REQUIRED_ANTIGRAVITY_AUTH_PLUGIN).trim();
  const openAICodexPluginEntry = (options.openAICodexAuthPluginEntry ?? REQUIRED_OPENAI_CODEX_AUTH_PLUGIN).trim();
  if (ensureAntigravityAuthPlugin && !hasPackagePlugin(pluginArray, ANTIGRAVITY_AUTH_PACKAGE_NAME)) {
    pluginArray.push(antigravityPluginEntry);
  }
  if (ensureOpenAICodexAuthPlugin && !hasPackagePlugin(pluginArray, OPENAI_CODEX_AUTH_PACKAGE_NAME)) {
    pluginArray.push(openAICodexPluginEntry);
  }
  opencodeConfig.plugin = [...pluginArray];

  removeLegacySequentialThinkingAlias(opencodeConfig);
  removeLegacyOrchestratorAgents(opencodeConfig);

  const ensuredBuiltinMcps = applyBuiltinMcps(opencodeConfig, parsedAegisConfig, opencodeDir);
  const addedAgents = applyRequiredAgents(opencodeConfig, parsedAegisConfig, {
    environment: options.environment,
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
