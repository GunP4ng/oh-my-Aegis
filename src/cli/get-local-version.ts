import { existsSync, readFileSync } from "node:fs";
import { resolveLatestPackageVersion, resolveOpencodeConfigPath, resolveOpencodeDir } from "../install/apply-config";
import { stripJsonComments } from "../utils/json";

const packageJson = await import("../../package.json");
const PACKAGE_NAME =
  typeof packageJson.name === "string" && packageJson.name.trim().length > 0
    ? packageJson.name
    : "oh-my-aegis";
const PACKAGE_VERSION =
  typeof packageJson.version === "string" && packageJson.version.trim().length > 0
    ? packageJson.version
    : "0.0.0";

interface LocalVersionReport {
  packageName: string;
  localVersion: string;
  latestVersion: string | null;
  isUpToDate: boolean | null;
  opencodeConfigPath: string | null;
  installedPluginEntry: string | null;
}

function findInstalledPluginEntry(path: string | null): string | null {
  if (!path || !existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
    const plugins = Array.isArray(parsed.plugin) ? parsed.plugin : [];
    for (const item of plugins) {
      if (typeof item !== "string") continue;
      if (item === PACKAGE_NAME || item.startsWith(`${PACKAGE_NAME}@`)) {
        return item;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function runGetLocalVersion(commandArgs: string[] = []): Promise<number> {
  const json = commandArgs.includes("--json");

  const opencodeDir = resolveOpencodeDir(process.env);
  const configPath = resolveOpencodeConfigPath(opencodeDir);
  const installedPluginEntry = findInstalledPluginEntry(configPath);
  const latestVersion = await resolveLatestPackageVersion(PACKAGE_NAME);

  const report: LocalVersionReport = {
    packageName: PACKAGE_NAME,
    localVersion: PACKAGE_VERSION,
    latestVersion,
    isUpToDate: latestVersion ? latestVersion === PACKAGE_VERSION : null,
    opencodeConfigPath: existsSync(configPath) ? configPath : null,
    installedPluginEntry,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  const lines = [
    `Package: ${report.packageName}`,
    `Local version: ${report.localVersion}`,
    `Latest npm version: ${report.latestVersion ?? "(unavailable)"}`,
    `Up to date: ${
      report.isUpToDate === null ? "(unknown: npm lookup unavailable)" : report.isUpToDate ? "yes" : "no"
    }`,
    `OpenCode config: ${report.opencodeConfigPath ?? "(not found)"}`,
    `Installed plugin entry: ${report.installedPluginEntry ?? "(not installed)"}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
