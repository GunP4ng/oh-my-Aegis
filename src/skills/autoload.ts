import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import { baseAgentName } from "../orchestration/model-health";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueOrdered(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function resolveOpencodeDir(environment: NodeJS.ProcessEnv = process.env): string | null {
  const xdg = environment.XDG_CONFIG_HOME;
  if (xdg && xdg.trim().length > 0) {
    const candidate = join(xdg, "opencode");
    if (existsSync(candidate)) return candidate;
  }

  const home = environment.HOME;
  if (home && home.trim().length > 0) {
    const candidate = join(home, ".config", "opencode");
    if (existsSync(candidate)) return candidate;
  }

  const appData = environment.APPDATA;
  if (process.platform === "win32" && appData && appData.trim().length > 0) {
    const candidate = join(appData, "opencode");
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function listSkillNames(skillsDir: string): string[] {
  if (!skillsDir || !existsSync(skillsDir)) {
    return [];
  }
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (!name || name.startsWith(".")) continue;
      const skillPath = join(skillsDir, name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

export function discoverAvailableSkills(
  projectDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const out = new Set<string>();

  const opencodeDir = resolveOpencodeDir(environment);
  const candidates = [
    opencodeDir ? join(opencodeDir, "skills") : "",
    join(projectDir, ".opencode", "skills"),
    join(projectDir, ".claude", "skills"),
  ].filter(Boolean);

  for (const dir of candidates) {
    for (const name of listSkillNames(dir)) {
      out.add(name);
    }
  }

  return out;
}

function phaseKey(phase: SessionState["phase"]): "scan" | "plan" | "execute" {
  if (phase === "SCAN") return "scan";
  if (phase === "PLAN") return "plan";
  return "execute";
}

function normalizeSkillList(input: unknown): string[] {
  const raw: string[] = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      if (isNonEmptyString(item)) raw.push(item);
    }
  } else if (isNonEmptyString(input)) {
    raw.push(input);
  }

  return uniqueOrdered(raw);
}

function filterAvailable(skills: string[], availableSkills: Set<string>): string[] {
  if (availableSkills.size === 0) {
    return skills;
  }
  return skills.filter((name) => availableSkills.has(name));
}

export function resolveAutoloadSkills(params: {
  state: SessionState;
  config: OrchestratorConfig;
  subagentType: string;
  availableSkills: Set<string>;
}): string[] {
  const cfg = params.config.skill_autoload;
  if (!cfg.enabled) return [];

  const modeKey = params.state.mode === "CTF" ? "ctf" : "bounty";
  const phase = phaseKey(params.state.phase);
  const target = params.state.targetType;

  const baseSubagent = baseAgentName(params.subagentType);
  const bySubagent = cfg.by_subagent[baseSubagent] ?? [];

  const baseList = cfg[modeKey][phase][target] ?? [];
  return filterAvailable(normalizeSkillList([...baseList, ...bySubagent]), params.availableSkills);
}

export function mergeLoadSkills(params: {
  existing: unknown;
  autoload: string[];
  maxSkills: number;
  availableSkills: Set<string>;
}): string[] {
  const existing = normalizeSkillList(params.existing);
  const autoload = filterAvailable(normalizeSkillList(params.autoload), params.availableSkills);
  const cap = Number.isFinite(params.maxSkills) ? params.maxSkills : 0;
  if (cap <= 0) {
    return existing;
  }
  if (existing.length >= cap) {
    return existing;
  }
  const remaining = cap - existing.length;
  const seen = new Set(existing);
  const extras: string[] = [];
  for (const name of autoload) {
    if (seen.has(name)) continue;
    seen.add(name);
    extras.push(name);
    if (extras.length >= remaining) break;
  }
  return existing.concat(extras);
}
