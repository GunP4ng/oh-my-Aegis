import { existsSync } from "node:fs";
import { join } from "node:path";

const OPENCODE_JSON = "opencode.json";
const OPENCODE_JSONC = "opencode.jsonc";

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

export function resolveDefaultOpencodeDirCandidates(
  environment: NodeJS.ProcessEnv = process.env
): string[] {
  const home = environment.HOME ?? "";
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
  return resolveDefaultOpencodeDirCandidates(environment).map((dir) => join(dir, "oh-my-Aegis.json"));
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
    ...resolveDefaultOpencodeDirCandidates(environment).map((dir) => join(dir, "opencode")),
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
