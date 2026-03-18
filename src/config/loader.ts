import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OrchestratorConfigSchema, type OrchestratorConfig } from "./schema";
import { resolveDefaultAegisUserConfigCandidates } from "./opencode-config-path";
import { stripJsonComments } from "../utils/json";
import { isRecord } from "../utils/is-record";

const DEFAULT_CONFIG = OrchestratorConfigSchema.parse({});

function deepMerge(a: unknown, b: unknown): Record<string, unknown> {
  const left = isRecord(a) ? a : {};
  const right = isRecord(b) ? b : {};
  const out: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = out[key];
    if (isRecord(existing) && isRecord(value)) {
      out[key] = deepMerge(existing, value);
      continue;
    }
    out[key] = value;
  }
  return out;
}


function readJSON(path: string, onWarning?: (msg: string) => void): unknown {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const stripped = stripJsonComments(raw);
    return JSON.parse(stripped);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (onWarning) {
      onWarning(`Failed to parse config JSON: ${path} (${message})`);
    }
    return {};
  }
}

function resolveConfigPath(candidate: string): string {
  if (existsSync(candidate)) {
    return candidate;
  }
  if (candidate.toLowerCase().endsWith(".json")) {
    const jsonc = `${candidate.slice(0, -5)}.jsonc`;
    if (existsSync(jsonc)) {
      return jsonc;
    }
  }
  return candidate;
}

function mergeMissingStringEntries(current: string[], defaults: string[]): string[] {
  const merged = [...current];
  const seen = new Set(current);
  for (const entry of defaults) {
    if (seen.has(entry)) {
      continue;
    }
    merged.push(entry);
    seen.add(entry);
  }
  return merged;
}

function normalizeCriticalConfigDefaults(config: OrchestratorConfig): OrchestratorConfig {
  return {
    ...config,
    guardrails: {
      ...config.guardrails,
      destructive_command_patterns: mergeMissingStringEntries(
        config.guardrails.destructive_command_patterns,
        DEFAULT_CONFIG.guardrails.destructive_command_patterns,
      ),
      bounty_scope_readonly_patterns: mergeMissingStringEntries(
        config.guardrails.bounty_scope_readonly_patterns,
        DEFAULT_CONFIG.guardrails.bounty_scope_readonly_patterns,
      ),
    },
    bounty_policy: {
      ...config.bounty_policy,
      scanner_command_patterns: mergeMissingStringEntries(
        config.bounty_policy.scanner_command_patterns,
        DEFAULT_CONFIG.bounty_policy.scanner_command_patterns,
      ),
    },
  };
}

export function loadConfig(
  projectDir: string,
  options?: {
    onWarning?: (msg: string) => void;
  },
): OrchestratorConfig {
  const projectPath = resolveConfigPath(join(projectDir, ".Aegis", "oh-my-Aegis.json"));
  const userCandidates = resolveDefaultAegisUserConfigCandidates(process.env).map((candidate) =>
    resolveConfigPath(candidate)
  );
  const warn = options?.onWarning;

  let userConfig: unknown = {};
  for (const candidate of userCandidates) {
    if (existsSync(candidate)) {
      userConfig = readJSON(candidate, warn);
      break;
    }
  }
  const projectConfig = readJSON(projectPath, warn);
  const projectConfigSanitized = isRecord(projectConfig)
    ? (() => {
      const copy: Record<string, unknown> = { ...projectConfig };
      delete copy.claude_hooks;
      return copy;
    })()
    : projectConfig;
  const merged = deepMerge(userConfig, projectConfigSanitized);
  const parsed = OrchestratorConfigSchema.safeParse(merged);
  if (parsed.success) {
    return normalizeCriticalConfigDefaults(parsed.data);
  }
  if (warn) {
    warn(`Config schema validation failed; falling back to defaults (issues=${parsed.error.issues.length}).`);
  }
  return DEFAULT_CONFIG;
}
