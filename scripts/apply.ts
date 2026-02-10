import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OrchestratorConfigSchema } from "../src/config/schema";
import { createBuiltinMcps } from "../src/mcp";
import { requiredDispatchSubagents } from "../src/orchestration/task-dispatch";

type JsonObject = Record<string, unknown>;

const DEFAULT_AGENT_MODEL = "openai/gpt-5.3-codex";
const DEFAULT_AGENT_VARIANT = "medium";

const AGENT_OVERRIDES: Record<string, { model: string; variant: string }> = {
  "ctf-web": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-web3": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-pwn": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-rev": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-crypto": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-forensics": { model: "google/antigravity-gemini-3-flash", variant: "medium" },
  "ctf-explore": { model: "google/antigravity-gemini-3-flash", variant: "minimal" },
  "ctf-solve": { model: "openai/gpt-5.3-codex", variant: "high" },
  "ctf-research": { model: "google/antigravity-gemini-3-flash", variant: "medium" },
  "ctf-hypothesis": { model: "google/antigravity-claude-sonnet-4-5-thinking", variant: "low" },
  "ctf-decoy-check": { model: "google/antigravity-gemini-3-flash", variant: "minimal" },
  "ctf-verify": { model: "openai/gpt-5.3-codex", variant: "medium" },
  "bounty-scope": { model: "openai/gpt-5.3-codex", variant: "medium" },
  "bounty-triage": { model: "openai/gpt-5.3-codex", variant: "high" },
  "bounty-research": { model: "google/antigravity-gemini-3-flash", variant: "medium" },
  "deep-plan": { model: "google/antigravity-claude-sonnet-4-5-thinking", variant: "low" },
  "md-scribe": { model: "google/antigravity-gemini-3-flash", variant: "medium" },
  "explore-fallback": { model: "google/antigravity-gemini-3-flash", variant: "medium" },
  "librarian-fallback": { model: "google/antigravity-gemini-3-pro", variant: "low" },
  "oracle-fallback": { model: "google/antigravity-gemini-3-pro", variant: "high" },
};

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
  auto_dispatch: {
    enabled: true,
    preserve_user_category: true,
    max_failover_retries: 2,
  },
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf-8");
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

function ensurePluginArray(config: JsonObject): string[] {
  const candidate = config.plugin;
  if (Array.isArray(candidate)) {
    return candidate.filter((item): item is string => typeof item === "string");
  }
  return [];
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

function resolveOpencodeDir(): string {
  const home = process.env.HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  const appData = process.env.APPDATA;

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

function main(): void {
  const cwd = process.cwd();
  const distPluginPath = join(cwd, "dist", "index.js");
  if (!existsSync(distPluginPath)) {
    throw new Error(`Built plugin not found: ${distPluginPath}. Run 'bun run build' first.`);
  }

  const opencodeDir = resolveOpencodeDir();
  const opencodePath = join(opencodeDir, "opencode.json");
  const aegisPath = join(opencodeDir, "oh-my-Aegis.json");

  ensureDir(opencodeDir);

  const opencodeConfig = readJson(opencodePath);
  const aegisExisting = readJson(aegisPath);
  const aegisConfig = mergeAegisConfig(aegisExisting);
  const parsedAegisConfig = OrchestratorConfigSchema.parse(aegisConfig);

  const backupSuffix = new Date().toISOString().replace(/[:.]/g, "-");
  const opencodeBackup = `${opencodePath}.bak.${backupSuffix}`;
  if (existsSync(opencodePath)) {
    copyFileSync(opencodePath, opencodeBackup);
  }

  const pluginArray = ensurePluginArray(opencodeConfig);
  if (!pluginArray.includes(distPluginPath)) {
    pluginArray.push(distPluginPath);
  }
  opencodeConfig.plugin = pluginArray;

  const mcpMap = ensureMcpMap(opencodeConfig);
  if (parsedAegisConfig.enable_builtin_mcps) {
    const builtinMcps = createBuiltinMcps(parsedAegisConfig.disabled_mcps);
    for (const [name, serverConfig] of Object.entries(builtinMcps)) {
      if (!isObject(mcpMap[name])) {
        mcpMap[name] = serverConfig;
      }
    }
  }

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

  writeJson(opencodePath, opencodeConfig);

  writeJson(aegisPath, parsedAegisConfig as unknown as JsonObject);

  const lines = [
    "oh-my-Aegis apply complete.",
    `- plugin path ensured: ${distPluginPath}`,
    `- OpenCode config updated: ${opencodePath}`,
    existsSync(opencodeBackup) ? `- backup created: ${opencodeBackup}` : "- backup skipped (new config)",
    `- Aegis config ensured: ${aegisPath}`,
    addedAgents.length > 0
      ? `- added missing subagents: ${addedAgents.join(", ")}`
      : "- subagent mappings already present",
    parsedAegisConfig.enable_builtin_mcps
      ? `- ensured builtin MCPs: ${Object.keys(createBuiltinMcps(parsedAegisConfig.disabled_mcps)).join(", ") || "none"}`
      : "- builtin MCPs disabled by config",
    "- verify with: ctf_orch_readiness",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
