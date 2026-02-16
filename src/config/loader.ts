import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OrchestratorConfigSchema, type OrchestratorConfig } from "./schema";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function stripJsonComments(raw: string): string {
  let out = "";
  let inString = false;
  let isEscaped = false;
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
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (ch === "\\") {
        isEscaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
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

export function loadConfig(
  projectDir: string,
  options?: {
    onWarning?: (msg: string) => void;
  },
): OrchestratorConfig {
  const projectPath = resolveConfigPath(join(projectDir, ".Aegis", "oh-my-Aegis.json"));
  const userCandidates: string[] = [];
  const xdg = process.env.XDG_CONFIG_HOME;
  const home = process.env.HOME;
  const appData = process.env.APPDATA;
  const warn = options?.onWarning;

  if (xdg) {
    userCandidates.push(resolveConfigPath(join(xdg, "opencode", "oh-my-Aegis.json")));
  }
  if (home) {
    userCandidates.push(resolveConfigPath(join(home, ".config", "opencode", "oh-my-Aegis.json")));
  }
  if (process.platform === "win32" && appData) {
    userCandidates.push(resolveConfigPath(join(appData, "opencode", "oh-my-Aegis.json")));
  }

  let userConfig: unknown = {};
  for (const candidate of userCandidates) {
    if (existsSync(candidate)) {
      userConfig = readJSON(candidate, warn);
      break;
    }
  }
  const projectConfig = readJSON(projectPath, warn);
  const merged = deepMerge(userConfig, projectConfig);
  const parsed = OrchestratorConfigSchema.safeParse(merged);
  if (parsed.success) {
    return parsed.data;
  }
  if (warn) {
    warn(`Config schema validation failed; falling back to defaults (issues=${parsed.error.issues.length}).`);
  }
  return OrchestratorConfigSchema.parse({});
}
