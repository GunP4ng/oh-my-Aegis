import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export type SandboxStrategy = "worktree" | "clone";
export type SandboxStrategyMode = SandboxStrategy | "auto";

export interface SandboxLifecycle {
  runID: string;
  repoRoot: string;
  runRootDir: string;
  sandboxPath: string;
  sandboxRelativePath: string;
  baseRevision: string;
  strategy: SandboxStrategy;
  cleanup: () => void;
}

export interface SandboxManifestRecord {
  schemaVersion: 1;
  runID: string;
  createdAt: string;
  updatedAt: string;
  sandbox: {
    strategy: SandboxStrategy;
    path: string;
    baseRevision: string;
    executionCwd: string;
    cleanedUp: boolean;
  };
  artifacts: {
    patchDiffRef: string;
  };
}

type GitExecResult = {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
};

function toPosixPath(value: string): string {
  return value.split(sep).join("/");
}

function runGit(cwd: string, args: string[]): GitExecResult {
  const out = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return {
    ok: out.status === 0,
    status: typeof out.status === "number" ? out.status : 1,
    stdout: out.stdout ?? "",
    stderr: out.stderr ?? "",
  };
}

function ensureGitRepoRoot(repositoryDir: string): string {
  const resolved = resolve(repositoryDir);
  const result = runGit(resolved, ["rev-parse", "--show-toplevel"]);
  if (!result.ok) {
    throw new Error(`sandbox bootstrap failed: not a git repository (${result.stderr.trim() || "git rev-parse failed"})`);
  }
  const root = result.stdout.trim();
  if (!root) {
    throw new Error("sandbox bootstrap failed: empty git repository root");
  }
  return resolve(root);
}

function resolveBaseRevision(repoRoot: string, requested?: string): string {
  if (typeof requested === "string" && requested.trim().length > 0) {
    const target = requested.trim();
    const verify = runGit(repoRoot, ["rev-parse", "--verify", target]);
    if (!verify.ok) {
      throw new Error(`sandbox bootstrap failed: invalid base revision '${target}'`);
    }
    return verify.stdout.trim();
  }
  const head = runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  if (!head.ok) {
    throw new Error("sandbox bootstrap failed: unable to resolve HEAD revision");
  }
  return head.stdout.trim();
}

function tryBootstrapWorktree(repoRoot: string, sandboxPath: string, baseRevision: string): { ok: true } | { ok: false; reason: string } {
  const add = runGit(repoRoot, ["worktree", "add", "--detach", sandboxPath, baseRevision]);
  if (!add.ok) {
    return { ok: false, reason: add.stderr.trim() || "git worktree add failed" };
  }
  return { ok: true };
}

function tryBootstrapClone(repoRoot: string, sandboxPath: string, baseRevision: string): { ok: true } | { ok: false; reason: string } {
  const clone = runGit(repoRoot, ["clone", "--no-checkout", repoRoot, sandboxPath]);
  if (!clone.ok) {
    return { ok: false, reason: clone.stderr.trim() || "git clone failed" };
  }
  const checkout = runGit(sandboxPath, ["checkout", "--detach", baseRevision]);
  if (!checkout.ok) {
    return { ok: false, reason: checkout.stderr.trim() || "git checkout failed" };
  }
  return { ok: true };
}

export function createSandboxLifecycle(params: {
  repositoryDir: string;
  runID?: string;
  baseRevision?: string;
  strategy?: SandboxStrategyMode;
}): SandboxLifecycle {
  const repoRoot = ensureGitRepoRoot(params.repositoryDir);
  const runID = params.runID?.trim() || `run-${randomUUID()}`;
  const baseRevision = resolveBaseRevision(repoRoot, params.baseRevision);
  const strategyMode: SandboxStrategyMode = params.strategy ?? "auto";

  const runRootDir = join(repoRoot, ".Aegis", "runs", runID);
  const sandboxPath = join(runRootDir, "sandbox");
  mkdirSync(runRootDir, { recursive: true });

  const strategies: SandboxStrategy[] = strategyMode === "auto" ? ["worktree", "clone"] : [strategyMode];

  let selected: SandboxStrategy | null = null;
  let lastReason = "sandbox bootstrap failed";

  for (const strategy of strategies) {
    if (strategy === "worktree") {
      const result = tryBootstrapWorktree(repoRoot, sandboxPath, baseRevision);
      if (result.ok) {
        selected = strategy;
        break;
      }
      lastReason = result.reason;
      continue;
    }

    const result = tryBootstrapClone(repoRoot, sandboxPath, baseRevision);
    if (result.ok) {
      selected = strategy;
      break;
    }
    lastReason = result.reason;
    rmSync(sandboxPath, { recursive: true, force: true });
  }

  if (!selected) {
    throw new Error(`sandbox bootstrap failed: ${lastReason}`);
  }

  const cleanup = (): void => {
    if (selected === "worktree") {
      const remove = runGit(repoRoot, ["worktree", "remove", "--force", sandboxPath]);
      if (!remove.ok) {
        rmSync(sandboxPath, { recursive: true, force: true });
      }
      void runGit(repoRoot, ["worktree", "prune"]);
      return;
    }
    rmSync(sandboxPath, { recursive: true, force: true });
  };

  return {
    runID,
    repoRoot,
    runRootDir,
    sandboxPath,
    sandboxRelativePath: toPosixPath(relative(repoRoot, sandboxPath)),
    baseRevision,
    strategy: selected,
    cleanup,
  };
}

export function writeSandboxManifest(params: {
  lifecycle: SandboxLifecycle;
  patchDiffRef: string;
  cleanedUp: boolean;
}): { manifestPath: string; manifestRef: string; manifest: SandboxManifestRecord } {
  const now = new Date().toISOString();
  const manifestPath = join(params.lifecycle.runRootDir, "run-manifest.json");
  const existing = (() => {
    try {
      const raw = readFileSync(manifestPath, "utf-8");
      return JSON.parse(raw) as Partial<SandboxManifestRecord>;
    } catch {
      return null;
    }
  })();

  const createdAt = typeof existing?.createdAt === "string" ? existing.createdAt : now;
  const manifest: SandboxManifestRecord = {
    schemaVersion: 1,
    runID: params.lifecycle.runID,
    createdAt,
    updatedAt: now,
    sandbox: {
      strategy: params.lifecycle.strategy,
      path: `.${toPosixPath(`/${params.lifecycle.sandboxRelativePath}`)}`,
      baseRevision: params.lifecycle.baseRevision,
      executionCwd: `.${toPosixPath(`/${params.lifecycle.sandboxRelativePath}`)}`,
      cleanedUp: params.cleanedUp,
    },
    artifacts: {
      patchDiffRef: params.patchDiffRef,
    },
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return {
    manifestPath,
    manifestRef: toPosixPath(relative(params.lifecycle.repoRoot, manifestPath)),
    manifest,
  };
}
