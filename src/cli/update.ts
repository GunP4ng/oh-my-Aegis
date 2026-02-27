import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AUTO_UPDATE_STATE_FILE = join(".Aegis", "auto-update-state.json");
const DEFAULT_INTERVAL_MS = 1000 * 60 * 60 * 6;

export type AutoUpdateStatus =
  | "disabled"
  | "not_git_repo"
  | "no_upstream"
  | "throttled"
  | "up_to_date"
  | "dirty_worktree"
  | "diverged"
  | "updated"
  | "failed";

interface AutoUpdateState {
  lastCheckedAt: number;
  lastStatus: AutoUpdateStatus;
  lastHead: string;
  lastUpstream: string;
}

export interface AutoUpdateResult {
  status: AutoUpdateStatus;
  repoRoot: string | null;
  detail: string;
}

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], cwd: string): RunResult {
  try {
    const out = execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return { ok: true, stdout: out.trim(), stderr: "" };
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : "";
    return { ok: false, stdout: "", stderr: stderr.trim() };
  }
}

function packageRootFromModule(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..");
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeState(path: string, state: AutoUpdateState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function readState(path: string): AutoUpdateState | null {
  const raw = readJson(path);
  if (!raw) {
    return null;
  }
  return {
    lastCheckedAt:
      typeof raw.lastCheckedAt === "number" && Number.isFinite(raw.lastCheckedAt)
        ? raw.lastCheckedAt
        : 0,
    lastStatus: typeof raw.lastStatus === "string" ? (raw.lastStatus as AutoUpdateStatus) : "failed",
    lastHead: typeof raw.lastHead === "string" ? raw.lastHead : "",
    lastUpstream: typeof raw.lastUpstream === "string" ? raw.lastUpstream : "",
  };
}

function parseIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AEGIS_NPM_AUTO_UPDATE_INTERVAL_MINUTES;
  if (!raw) {
    return DEFAULT_INTERVAL_MS;
  }
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 1) {
    return DEFAULT_INTERVAL_MS;
  }
  return Math.floor(minutes) * 60 * 1000;
}

export function isAutoUpdateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.AEGIS_NPM_AUTO_UPDATE ?? "").trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !["0", "false", "off", "no"].includes(raw);
}

export function findGitRepoRoot(startDir: string, stopDir?: string): string | null {
  let current = resolve(startDir);
  const boundary = stopDir ? resolve(stopDir) : null;
  for (let depth = 0; depth < 20; depth += 1) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    if (boundary && current === boundary) {
      break;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export async function maybeAutoUpdate(options?: {
  force?: boolean;
  silent?: boolean;
}): Promise<AutoUpdateResult> {
  if (!isAutoUpdateEnabled()) {
    return {
      status: "disabled",
      repoRoot: null,
      detail: "disabled by AEGIS_NPM_AUTO_UPDATE",
    };
  }

  const moduleRoot = packageRootFromModule();
  const repoRoot = findGitRepoRoot(moduleRoot, moduleRoot);
  if (!repoRoot) {
    return {
      status: "not_git_repo",
      repoRoot: null,
      detail: "current install is not a git checkout",
    };
  }

  const upstream = run("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], repoRoot);
  if (!upstream.ok || upstream.stdout.length === 0) {
    return {
      status: "no_upstream",
      repoRoot,
      detail: "upstream branch is not configured",
    };
  }

  const now = Date.now();
  const statePath = join(repoRoot, AUTO_UPDATE_STATE_FILE);
  const intervalMs = parseIntervalMs();
  const prior = readState(statePath);
  if (!options?.force && prior && now - prior.lastCheckedAt < intervalMs) {
    return {
      status: "throttled",
      repoRoot,
      detail: "skipped by throttle window",
    };
  }

  const fetchResult = run("git", ["fetch", "--quiet", "origin"], repoRoot);
  if (!fetchResult.ok) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "failed",
      lastHead: "",
      lastUpstream: "",
    });
    return {
      status: "failed",
      repoRoot,
      detail: `git fetch failed: ${fetchResult.stderr || "unknown error"}`,
    };
  }

  const head = run("git", ["rev-parse", "HEAD"], repoRoot);
  const upstreamHead = run("git", ["rev-parse", "@{upstream}"], repoRoot);
  if (!head.ok || !upstreamHead.ok) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "failed",
      lastHead: "",
      lastUpstream: "",
    });
    return {
      status: "failed",
      repoRoot,
      detail: "failed to resolve local/upstream head",
    };
  }

  if (head.stdout === upstreamHead.stdout) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "up_to_date",
      lastHead: head.stdout,
      lastUpstream: upstreamHead.stdout,
    });
    return {
      status: "up_to_date",
      repoRoot,
      detail: "already up to date",
    };
  }

  const statusResult = run("git", ["status", "--porcelain"], repoRoot);
  if (!statusResult.ok) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "failed",
      lastHead: head.stdout,
      lastUpstream: upstreamHead.stdout,
    });
    return {
      status: "failed",
      repoRoot,
      detail: "failed to inspect git working tree",
    };
  }
  if (statusResult.stdout.length > 0) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "dirty_worktree",
      lastHead: head.stdout,
      lastUpstream: upstreamHead.stdout,
    });
    return {
      status: "dirty_worktree",
      repoRoot,
      detail: "worktree dirty; skipping auto update",
    };
  }

  const aheadBehind = run("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], repoRoot);
  if (!aheadBehind.ok) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "failed",
      lastHead: head.stdout,
      lastUpstream: upstreamHead.stdout,
    });
    return {
      status: "failed",
      repoRoot,
      detail: "failed to compute ahead/behind state",
    };
  }

  const [aheadRaw, behindRaw] = aheadBehind.stdout.split(/\s+/);
  const ahead = Number(aheadRaw ?? "0");
  const behind = Number(behindRaw ?? "0");
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "failed",
      lastHead: head.stdout,
      lastUpstream: upstreamHead.stdout,
    });
    return {
      status: "failed",
      repoRoot,
      detail: "invalid ahead/behind values",
    };
  }

  if (ahead > 0 && behind > 0) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "diverged",
      lastHead: head.stdout,
      lastUpstream: upstreamHead.stdout,
    });
    return {
      status: "diverged",
      repoRoot,
      detail: "local branch diverged from upstream; skipping auto update",
    };
  }

  if (behind <= 0) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "up_to_date",
      lastHead: head.stdout,
      lastUpstream: upstreamHead.stdout,
    });
    return {
      status: "up_to_date",
      repoRoot,
      detail: "already up to date",
    };
  }

  const pull = run("git", ["pull", "--ff-only"], repoRoot);
  if (!pull.ok) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "failed",
      lastHead: head.stdout,
      lastUpstream: upstreamHead.stdout,
    });
    return {
      status: "failed",
      repoRoot,
      detail: `git pull failed: ${pull.stderr || "unknown error"}`,
    };
  }

  const build = run("bun", ["run", "build"], repoRoot);
  if (!build.ok) {
    writeState(statePath, {
      lastCheckedAt: now,
      lastStatus: "failed",
      lastHead: head.stdout,
      lastUpstream: upstreamHead.stdout,
    });
    return {
      status: "failed",
      repoRoot,
      detail: `build after update failed: ${build.stderr || "unknown error"}`,
    };
  }

  const newHead = run("git", ["rev-parse", "HEAD"], repoRoot);
  const nextHead = newHead.ok ? newHead.stdout : head.stdout;
  writeState(statePath, {
    lastCheckedAt: now,
    lastStatus: "updated",
    lastHead: nextHead,
    lastUpstream: upstreamHead.stdout,
  });

  if (!options?.silent) {
    process.stdout.write(`[oh-my-aegis] auto-updated from git (${head.stdout.slice(0, 7)} -> ${nextHead.slice(0, 7)}).\n`);
  }

  return {
    status: "updated",
    repoRoot,
    detail: `updated ${head.stdout.slice(0, 7)} -> ${nextHead.slice(0, 7)}`,
  };
}

export async function runUpdate(commandArgs: string[] = []): Promise<number> {
  const json = commandArgs.includes("--json");
  const force = commandArgs.includes("--force");
  const result = await maybeAutoUpdate({ force, silent: json });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === "failed" ? 1 : 0;
  }

  const lines = [
    "oh-my-Aegis update check",
    `- status: ${result.status}`,
    `- repo: ${result.repoRoot ?? "(not git checkout)"}`,
    `- detail: ${result.detail}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return result.status === "failed" ? 1 : 0;
}
