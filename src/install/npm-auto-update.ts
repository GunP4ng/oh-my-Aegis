import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const STATE_FILE = join(".Aegis", "npm-auto-update-state.json");
const DEFAULT_INTERVAL_MS = 1000 * 60 * 60 * 6;

export type NpmAutoUpdateStatus =
  | "disabled"
  | "no_install_dir"
  | "no_package_json"
  | "throttled"
  | "up_to_date"
  | "updated"
  | "failed";

interface NpmAutoUpdateState {
  lastCheckedAt: number;
  lastStatus: NpmAutoUpdateStatus;
  lastLocalVersion: string;
  lastLatestVersion: string;
}

export interface NpmAutoUpdateResult {
  status: NpmAutoUpdateStatus;
  installDir: string | null;
  detail: string;
  localVersion: string | null;
  latestVersion: string | null;
}

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], cwd: string, timeoutMs: number): RunResult {
  try {
    const out = execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return { ok: true, stdout: out.trim(), stderr: "" };
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error && typeof (error as { stderr?: unknown }).stderr === "string"
        ? String((error as { stderr?: unknown }).stderr).trim()
        : "";
    return { ok: false, stdout: "", stderr };
  }
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeState(path: string, state: NpmAutoUpdateState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function readState(path: string): NpmAutoUpdateState | null {
  const raw = readJson(path);
  if (!raw) return null;
  return {
    lastCheckedAt: typeof raw.lastCheckedAt === "number" && Number.isFinite(raw.lastCheckedAt) ? raw.lastCheckedAt : 0,
    lastStatus: typeof raw.lastStatus === "string" ? (raw.lastStatus as NpmAutoUpdateStatus) : "failed",
    lastLocalVersion: typeof raw.lastLocalVersion === "string" ? raw.lastLocalVersion : "",
    lastLatestVersion: typeof raw.lastLatestVersion === "string" ? raw.lastLatestVersion : "",
  };
}

function parseIntervalMs(env: NodeJS.ProcessEnv): number {
  const raw = env.AEGIS_NPM_AUTO_UPDATE_INTERVAL_MINUTES;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 1) return DEFAULT_INTERVAL_MS;
  return Math.floor(minutes) * 60 * 1000;
}

export function isNpmAutoUpdateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.AEGIS_NPM_AUTO_UPDATE ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
}

export function resolveOpencodeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim().length > 0 ? env.XDG_CONFIG_HOME : "";
  const home = typeof env.HOME === "string" && env.HOME.trim().length > 0 ? env.HOME : "";
  const base = xdg ? xdg : home ? join(home, ".config") : ".";
  return resolve(join(base, "opencode"));
}

export function resolveOpencodeCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const isWindows = process.platform === "win32" || env.OS === "Windows_NT";
  if (isWindows) {
    const localAppData = typeof env.LOCALAPPDATA === "string" && env.LOCALAPPDATA.trim().length > 0 ? env.LOCALAPPDATA : "";
    const appData = typeof env.APPDATA === "string" && env.APPDATA.trim().length > 0 ? env.APPDATA : "";
    const base = localAppData || appData || ".";
    return resolve(join(base, "opencode"));
  }

  const xdg = typeof env.XDG_CACHE_HOME === "string" && env.XDG_CACHE_HOME.trim().length > 0 ? env.XDG_CACHE_HOME : "";
  const home = typeof env.HOME === "string" && env.HOME.trim().length > 0 ? env.HOME : "";
  const base = xdg ? xdg : home ? join(home, ".cache") : ".";
  return resolve(join(base, "opencode"));
}

function readInstalledVersion(installDir: string, packageName: string): string | null {
  const pkgPath = join(installDir, "node_modules", packageName, "package.json");
  const raw = readJson(pkgPath);
  const v = raw && typeof raw.version === "string" ? raw.version.trim() : "";
  return v.length > 0 ? v : null;
}

async function resolveLatestViaNpm(
  packageName: string,
  installDir: string,
  deps?: { runImpl?: typeof run }
): Promise<string | null> {
  const r = (deps?.runImpl ?? run)("npm", ["view", packageName, "version"], installDir, 10_000);
  const v = r.ok ? r.stdout.trim() : "";
  return v.length > 0 ? v : null;
}

export async function maybeNpmAutoUpdatePackage(options: {
  packageName: string;
  installDir?: string;
  currentVersion?: string;
  force?: boolean;
  silent?: boolean;
  env?: NodeJS.ProcessEnv;
  deps?: {
    runImpl?: typeof run;
    resolveLatest?: (packageName: string, installDir: string) => Promise<string | null>;
    nowImpl?: () => number;
  };
}): Promise<NpmAutoUpdateResult> {
  const env = options.env ?? process.env;
  if (!isNpmAutoUpdateEnabled(env)) {
    return {
      status: "disabled",
      installDir: null,
      detail: "disabled by AEGIS_NPM_AUTO_UPDATE",
      localVersion: null,
      latestVersion: null,
    };
  }

  const installDir = options.installDir ? resolve(options.installDir) : resolveOpencodeConfigDir(env);
  if (!installDir || !existsSync(installDir)) {
    return {
      status: "no_install_dir",
      installDir: installDir || null,
      detail: "install dir not found",
      localVersion: null,
      latestVersion: null,
    };
  }

  const packageJsonPath = join(installDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {
      status: "no_package_json",
      installDir,
      detail: "package.json not found; skipping npm auto-update",
      localVersion: null,
      latestVersion: null,
    };
  }

  const now = (options.deps?.nowImpl ?? Date.now)();
  const statePath = join(installDir, STATE_FILE);
  const intervalMs = parseIntervalMs(env);
  const prior = readState(statePath);
  if (!options.force && prior && now - prior.lastCheckedAt < intervalMs) {
    return {
      status: "throttled",
      installDir,
      detail: "skipped by throttle window",
      localVersion: prior.lastLocalVersion || null,
      latestVersion: prior.lastLatestVersion || null,
    };
  }

  const localVersion = options.currentVersion?.trim().length ? options.currentVersion.trim() : readInstalledVersion(installDir, options.packageName);
  const resolveLatest = options.deps?.resolveLatest ?? ((pkg: string, dir: string) => resolveLatestViaNpm(pkg, dir, { runImpl: options.deps?.runImpl }));
  const latestVersion = await resolveLatest(options.packageName, installDir);
  if (!latestVersion) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "failed",
      lastLocalVersion: localVersion ?? "",
      lastLatestVersion: "",
    });
    return {
      status: "failed",
      installDir,
      detail: "failed to resolve npm latest version",
      localVersion,
      latestVersion: null,
    };
  }

  if (localVersion && localVersion === latestVersion) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "up_to_date",
      lastLocalVersion: localVersion,
      lastLatestVersion: latestVersion,
    });
    return {
      status: "up_to_date",
      installDir,
      detail: "already up to date",
      localVersion,
      latestVersion,
    };
  }

  const runImpl = options.deps?.runImpl ?? run;
  const install = runImpl("npm", ["install", "--prefer-online", `${options.packageName}@latest`], installDir, 60_000);
  if (!install.ok) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "failed",
      lastLocalVersion: localVersion ?? "",
      lastLatestVersion: latestVersion,
    });
    if (!options.silent) {
      process.stderr.write(`[oh-my-aegis] npm auto-update failed: ${install.stderr || "unknown error"}\n`);
    }
    return {
      status: "failed",
      installDir,
      detail: `npm install failed: ${install.stderr || "unknown error"}`,
      localVersion,
      latestVersion,
    };
  }

  const installedAfter = readInstalledVersion(installDir, options.packageName);
  const updatedOk = Boolean(installedAfter && installedAfter === latestVersion);
  writeState(statePath, {
    lastCheckedAt: now,
    lastStatus: updatedOk ? "updated" : "failed",
    lastLocalVersion: installedAfter ?? localVersion ?? "",
    lastLatestVersion: latestVersion,
  });

  return {
    status: updatedOk ? "updated" : "failed",
    installDir,
    detail: updatedOk
      ? `updated ${options.packageName} to ${latestVersion}`
      : `npm install ran but version is ${installedAfter ?? "(unknown)"}`,
    localVersion: installedAfter ?? localVersion,
    latestVersion,
  };
}
