import { existsSync } from "node:fs";
import { join } from "node:path";

const OPENCODE_JSON = "opencode.json";
const OPENCODE_JSONC = "opencode.jsonc";

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
  const home = environment.HOME ?? "";
  const xdg = environment.XDG_CONFIG_HOME ?? "";
  const appData = environment.APPDATA ?? "";

  const baseCandidates = [
    join(projectDir, ".opencode", "opencode"),
    join(projectDir, "opencode"),
    xdg ? join(xdg, "opencode", "opencode") : "",
    join(home, ".config", "opencode", "opencode"),
    appData ? join(appData, "opencode", "opencode") : "",
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
