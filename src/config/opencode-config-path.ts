import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripJsonComments } from "../utils/json";

const OPENCODE_JSON = "opencode.json";
const OPENCODE_JSONC = "opencode.jsonc";
const AEGIS_CONFIG_JSON = "oh-my-Aegis.json";
const OPENCODE_CONFIG_DIR_ENV = "OPENCODE_CONFIG_DIR";

function uniqueOrdered(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function hasOpencodeConfigFile(opencodeDir: string): boolean {
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

export function hasAegisInstallMarker(opencodeDir: string): boolean {
  if (!opencodeDir) {
    return false;
  }
  if (existsSync(join(opencodeDir, AEGIS_CONFIG_JSON))) {
    return true;
  }
  const plugins = readPluginEntries(opencodeDir);
  return plugins.some((plugin) => {
    const normalized = plugin.trim();
    if (!normalized) {
      return false;
    }
    if (normalized === "oh-my-aegis" || normalized.startsWith("oh-my-aegis@")) {
      return true;
    }
    const normalizedPath = normalized.replace(/\\/g, "/").toLowerCase();
    return (
      normalizedPath.includes("/oh-my-aegis/") ||
      normalizedPath.endsWith("/oh-my-aegis") ||
      normalizedPath.includes("/oh-my-aegis@")
    );
  });
}

function isOpencodeLeafDir(path: string): boolean {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  const tail = segments[segments.length - 1] ?? "";
  return tail.toLowerCase() === "opencode";
}

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
      continue;
    }
    const subdir = join(configRoot, entry);
    if (hasAegisInstallMarker(subdir) || hasOpencodeConfigFile(subdir)) {
      results.push(subdir);
    }
    const sub = join(subdir, "opencode");
    if (hasAegisInstallMarker(sub) || hasOpencodeConfigFile(sub)) {
      results.push(sub);
    }
  }
  return results;
}

export function resolveOpencodeDirCandidates(
  environment: NodeJS.ProcessEnv = process.env
): string[] {
  const candidates: string[] = [];
  const opencodeConfigDir = typeof environment[OPENCODE_CONFIG_DIR_ENV] === "string"
    ? environment[OPENCODE_CONFIG_DIR_ENV]
    : "";
  const xdg = environment.XDG_CONFIG_HOME;
  const home = environment.HOME ?? environment.USERPROFILE;

  if (opencodeConfigDir && opencodeConfigDir.trim().length > 0) {
    const overrideRoot = opencodeConfigDir.trim();
    const overrideOpencodeDir = isOpencodeLeafDir(overrideRoot) ? overrideRoot : join(overrideRoot, "opencode");
    if (hasAegisInstallMarker(overrideRoot) || hasOpencodeConfigFile(overrideRoot)) {
      candidates.push(overrideRoot);
    }
    if (hasAegisInstallMarker(overrideOpencodeDir) || hasOpencodeConfigFile(overrideOpencodeDir)) {
      candidates.push(overrideOpencodeDir);
    }
    candidates.push(overrideOpencodeDir);
    candidates.push(overrideRoot);
  }

  const configRoot = xdg && xdg.trim().length > 0
    ? xdg.trim()
    : home && home.trim().length > 0
      ? join(home.trim(), ".config")
      : "";

  if (configRoot) {
    const aegisSubdirs = scanConfigSubdirCandidates(configRoot).filter((dir) => hasAegisInstallMarker(dir));
    candidates.push(...aegisSubdirs);
  }

  candidates.push(...resolveDefaultOpencodeDirCandidates(environment));

  return uniqueOrdered(candidates);
}

export function resolveDefaultOpencodeDirCandidates(
  environment: NodeJS.ProcessEnv = process.env
): string[] {
  const home = environment.HOME ?? environment.USERPROFILE ?? "";
  const xdg = environment.XDG_CONFIG_HOME ?? "";
  const appData = environment.APPDATA ?? "";

  const candidates = [
    xdg ? join(xdg, "opencode-aegis", "opencode") : "",
    xdg ? join(xdg, "opencode") : "",
    home ? join(home, ".config", "opencode-aegis", "opencode") : "",
    home ? join(home, ".config", "opencode") : "",
    appData ? join(appData, "opencode-aegis", "opencode") : "",
    appData ? join(appData, "opencode") : "",
  ];

  return uniqueOrdered(candidates);
}

export function resolveDefaultAegisUserConfigCandidates(
  environment: NodeJS.ProcessEnv = process.env
): string[] {
  return resolveOpencodeDirCandidates(environment).map((dir) => join(dir, "oh-my-Aegis.json"));
}

export function resolveOpencodeConfigPathInDir(opencodeDir: string): string {
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

export function resolveProjectOpencodeConfigPath(
  projectDir: string,
  environment: NodeJS.ProcessEnv = process.env
): string | null {
  const baseCandidates = [
    join(projectDir, ".opencode", "opencode"),
    join(projectDir, "opencode"),
    ...resolveOpencodeDirCandidates(environment).map((dir) => join(dir, "opencode")),
  ];

  const candidates = [
    ...baseCandidates.map((base) => (base ? `${base}.jsonc` : "")),
    ...baseCandidates.map((base) => (base ? `${base}.json` : "")),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
