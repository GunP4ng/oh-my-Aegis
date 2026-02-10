import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OrchestratorConfigSchema, type OrchestratorConfig } from "./schema";

function readJSON(path: string): unknown {
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

export function loadConfig(projectDir: string): OrchestratorConfig {
  const projectPath = join(projectDir, ".Aegis", "oh-my-Aegis.json");
  const userCandidates: string[] = [];
  const xdg = process.env.XDG_CONFIG_HOME;
  const home = process.env.HOME;
  const appData = process.env.APPDATA;

  if (xdg) {
    userCandidates.push(join(xdg, "opencode", "oh-my-Aegis.json"));
  }
  if (home) {
    userCandidates.push(join(home, ".config", "opencode", "oh-my-Aegis.json"));
  }
  if (process.platform === "win32" && appData) {
    userCandidates.push(join(appData, "opencode", "oh-my-Aegis.json"));
  }

  let userConfig: unknown = {};
  for (const candidate of userCandidates) {
    if (existsSync(candidate)) {
      userConfig = readJSON(candidate);
      break;
    }
  }
  const projectConfig = readJSON(projectPath);
  const merged = { ...(userConfig as object), ...(projectConfig as object) };
  const parsed = OrchestratorConfigSchema.safeParse(merged);
  if (parsed.success) {
    return parsed.data;
  }
  return OrchestratorConfigSchema.parse({});
}
