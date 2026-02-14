import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requiredDispatchSubagents } from "../orchestration/task-dispatch";
import { agentModel, modelAlternatives, shouldGenerateVariants, variantAgentName } from "../orchestration/model-health";
import { loadScopePolicyFromWorkspace } from "../bounty/scope-policy";
import { TARGET_TYPES, type Mode, type TargetType } from "../state/types";
import type { NotesStore } from "../state/notes-store";
import type { OrchestratorConfig } from "./schema";
import { createBuiltinMcps } from "../mcp";

export interface ReadinessReport {
  ok: boolean;
  notesWritable: boolean;
  checkedConfigPath: string | null;
  scopeDoc: {
    found: boolean;
    path: string | null;
    warnings: string[];
    allowedHostsCount: number;
    deniedHostsCount: number;
    blackoutWindowsCount: number;
  };
  requiredSubagents: string[];
  missingSubagents: string[];
  requiredMcps: string[];
  missingMcps: string[];
  coverageByTarget: Record<string, { requiredSubagents: string[]; missingSubagents: string[] }>;
  issues: string[];
  warnings: string[];
}

const MODES: Mode[] = ["CTF", "BOUNTY"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveOpencodeConfigPath(projectDir: string): string | null {
  const home = process.env.HOME ?? "";
  const xdg = process.env.XDG_CONFIG_HOME ?? "";
  const appData = process.env.APPDATA ?? "";
  const candidates = [
    join(projectDir, ".opencode", "opencode.json"),
    join(projectDir, "opencode.json"),
    xdg ? join(xdg, "opencode", "opencode.json") : "",
    join(home, ".config", "opencode", "opencode.json"),
    appData ? join(appData, "opencode", "opencode.json") : "",
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function parseOpencodeConfig(path: string): { data: Record<string, unknown> | null; warning?: string } {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { data: null, warning: `OpenCode config is not an object: ${path}` };
    }
    return { data: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      data: null,
      warning: `Failed to parse OpenCode config '${path}': ${message}`,
    };
  }
}

function extractAgentMap(config: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const candidates = [config.agent, config.agents];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (isRecord(value)) {
        out[key] = value;
      }
    }
  }

  return out;
}

function requiredSubagentsForTarget(
  config: OrchestratorConfig,
  mode: Mode,
  targetType: TargetType
): string[] {
  const routing = mode === "CTF" ? config.routing.ctf : config.routing.bounty;
  const profile =
    mode === "CTF" ? config.capability_profiles.ctf[targetType] : config.capability_profiles.bounty[targetType];

  return [
    ...new Set([
      routing.scan[targetType],
      routing.plan[targetType],
      routing.execute[targetType],
      routing.stuck[targetType],
      routing.failover[targetType],
      ...profile.required_subagents,
    ]),
  ];
}

export function buildReadinessReport(
  projectDir: string,
  notesStore: NotesStore,
  config: OrchestratorConfig
): ReadinessReport {
  const notesWritable = notesStore.checkWritable();
  const scopeDocResult = loadScopePolicyFromWorkspace(projectDir, {
    candidates: config.bounty_policy.scope_doc_candidates,
  });
  const scopeDoc =
    scopeDocResult.ok
      ? {
          found: true,
          path: scopeDocResult.policy.sourcePath,
          warnings: scopeDocResult.policy.warnings,
          allowedHostsCount:
            scopeDocResult.policy.allowedHostsExact.length +
            scopeDocResult.policy.allowedHostsSuffix.length,
          deniedHostsCount:
            scopeDocResult.policy.deniedHostsExact.length +
            scopeDocResult.policy.deniedHostsSuffix.length,
          blackoutWindowsCount: scopeDocResult.policy.blackoutWindows.length,
        }
      : {
          found: false,
          path: null,
          warnings: [scopeDocResult.reason, ...scopeDocResult.warnings],
          allowedHostsCount: 0,
          deniedHostsCount: 0,
          blackoutWindowsCount: 0,
        };
  const requiredSubagents = new Set<string>(requiredDispatchSubagents(config));
  requiredSubagents.add(config.failover.map.explore);
  requiredSubagents.add(config.failover.map.librarian);
  requiredSubagents.add(config.failover.map.oracle);

  if (config.dynamic_model.enabled && config.dynamic_model.generate_variants) {
    const baseAgents = [...requiredSubagents];
    for (const baseAgent of baseAgents) {
      if (!shouldGenerateVariants(baseAgent)) {
        continue;
      }
      const model = agentModel(baseAgent);
      if (!model) {
        continue;
      }
      for (const alt of modelAlternatives(model)) {
        requiredSubagents.add(variantAgentName(baseAgent, alt));
      }
    }
  }
  const coverageByTarget: Record<string, { requiredSubagents: string[]; missingSubagents: string[] }> = {};
  const requiredMcps = config.enable_builtin_mcps ? Object.keys(createBuiltinMcps(config.disabled_mcps)) : [];

  const warnings: string[] = [];
  const issues: string[] = [];
  if (!notesWritable.ok) {
    issues.push(...notesWritable.issues);
  }

  if (config.bounty_policy.require_scope_doc && !scopeDoc.found) {
    issues.push(`Missing bounty scope document (required): ${scopeDoc.warnings.join("; ")}`);
  } else if (!scopeDoc.found) {
    warnings.push(`No bounty scope document detected: ${scopeDoc.warnings.join("; ")}`);
  }

  const configPath = resolveOpencodeConfigPath(projectDir);
  if (!configPath) {
    const message = "No OpenCode config file found; subagent/MCP mapping checks unavailable.";
    if (config.strict_readiness) {
      issues.push(message);
    } else {
      warnings.push(message);
    }
    return {
      ok: issues.length === 0,
      notesWritable: notesWritable.ok,
      checkedConfigPath: null,
      scopeDoc,
      requiredSubagents: [...requiredSubagents],
      missingSubagents: [],
      requiredMcps,
      missingMcps: [],
      coverageByTarget,
      issues,
      warnings,
    };
  }

  const parsed = parseOpencodeConfig(configPath);
  if (!parsed.data) {
    if (parsed.warning) {
      if (config.strict_readiness) {
        issues.push(parsed.warning);
      } else {
        warnings.push(parsed.warning);
      }
    }
    return {
      ok: issues.length === 0,
      notesWritable: notesWritable.ok,
      checkedConfigPath: configPath,
      scopeDoc,
      requiredSubagents: [...requiredSubagents],
      missingSubagents: [],
      requiredMcps,
      missingMcps: [],
      coverageByTarget,
      issues,
      warnings,
    };
  }

  const availableMap = extractAgentMap(parsed.data);
  const available = new Set<string>(Object.keys(availableMap));
  const missingSubagents = [...requiredSubagents].filter((name) => !available.has(name));
  if (missingSubagents.length > 0) {
    issues.push(`Missing required subagent mappings: ${missingSubagents.join(", ")}`);
  }

  const mcpMap = isRecord(parsed.data.mcp) ? parsed.data.mcp : {};
  const missingMcps = requiredMcps.filter((name) => !isRecord(mcpMap[name]));
  if (missingMcps.length > 0) {
    issues.push(`Missing required MCP mappings: ${missingMcps.join(", ")}`);
  }

  for (const mode of MODES) {
    for (const targetType of TARGET_TYPES) {
      const key = `${mode}:${targetType}`;
      const required = requiredSubagentsForTarget(config, mode, targetType);
      const missing = required.filter((name) => !available.has(name));
      coverageByTarget[key] = {
        requiredSubagents: required,
        missingSubagents: missing,
      };

      if (missing.length > 0) {
        issues.push(`[${key}] missing subagents: ${missing.join(", ")}`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    notesWritable: notesWritable.ok,
    checkedConfigPath: configPath,
    scopeDoc,
    requiredSubagents: [...requiredSubagents],
    missingSubagents,
    requiredMcps,
    missingMcps,
    coverageByTarget,
    issues,
    warnings,
  };
}
