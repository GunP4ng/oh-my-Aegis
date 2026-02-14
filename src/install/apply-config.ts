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

export { AGENT_OVERRIDES };

const DEFAULT_AEGIS_CONFIG = {
  enabled: true,
  strict_readiness: true,
  enable_injection_logging: true,
  enforce_todo_single_in_progress: true,
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
  const parsed = JSON.parse(raw);
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

export function resolveOpencodeDir(environment: NodeJS.ProcessEnv = process.env): string {
  const home = environment.HOME;
  const xdg = environment.XDG_CONFIG_HOME;
  const appData = environment.APPDATA;

  const candidates: string[] = [];
  if (xdg) {
    candidates.push(join(xdg, "opencode"));
  }
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

  return merged;
}

function hasPluginEntry(pluginArray: unknown[], pluginEntry: string): boolean {
  return pluginArray.some((item) => typeof item === "string" && item === pluginEntry);
}

function applyRequiredAgents(opencodeConfig: JsonObject, parsedAegisConfig: OrchestratorConfig): string[] {
  const agentMap = ensureAgentMap(opencodeConfig);
  const requiredSubagents = requiredDispatchSubagents(parsedAegisConfig);
  requiredSubagents.push(
    parsedAegisConfig.failover.map.explore,
    parsedAegisConfig.failover.map.librarian,
    parsedAegisConfig.failover.map.oracle
  );

  const addedAgents: string[] = [];
  for (const name of new Set(requiredSubagents)) {
    if (!isObject(agentMap[name])) {
      const profile = AGENT_OVERRIDES[name] ?? {
        model: DEFAULT_AGENT_MODEL,
        variant: DEFAULT_AGENT_VARIANT,
      };
      agentMap[name] = profile;
      addedAgents.push(name);
    }
  }

  if (parsedAegisConfig.dynamic_model.generate_variants) {
    for (const [baseName, baseProfile] of Object.entries(AGENT_OVERRIDES)) {
      const variants = generateVariantEntries(baseName, baseProfile);
      for (const v of variants) {
        if (!isObject(agentMap[v.name])) {
          agentMap[v.name] = { model: v.model, variant: v.variant };
          addedAgents.push(v.name);
        }
      }
    }
  }
  return addedAgents;
}

function applyBuiltinMcps(opencodeConfig: JsonObject, parsedAegisConfig: OrchestratorConfig): string[] {
  if (!parsedAegisConfig.enable_builtin_mcps) {
    return [];
  }

  const mcpMap = ensureMcpMap(opencodeConfig);
  const builtinMcps = createBuiltinMcps(parsedAegisConfig.disabled_mcps);
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
  const opencodePath = join(opencodeDir, "opencode.json");
  const aegisPath = join(opencodeDir, "oh-my-Aegis.json");

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
  opencodeConfig.plugin = pluginArray;

  const ensuredBuiltinMcps = applyBuiltinMcps(opencodeConfig, parsedAegisConfig);
  const addedAgents = applyRequiredAgents(opencodeConfig, parsedAegisConfig);

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
