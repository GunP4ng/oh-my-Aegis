import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import {
  validateUnifiedDiffAgainstPolicy,
  type PatchPolicy,
  type PatchOperation,
  type ParsedPatchFile,
} from "../risk/patch-policy";
import {
  createSandboxLifecycle,
  type SandboxLifecycle,
  writeSandboxManifest,
  type SandboxManifestRecord,
  type SandboxStrategyMode,
} from "./sandbox";

export interface PatchArtifactManifestFile {
  path: string;
  operation: PatchOperation;
  added: number;
  removed: number;
  binary: boolean;
}

export interface PatchArtifactManifest {
  schema_version: 1;
  run_id: string;
  patch_sha256: string;
  file_count: number;
  total_added: number;
  total_removed: number;
  total_loc: number;
  files: PatchArtifactManifestFile[];
}

export type PatchBoundaryResult =
  | {
      ok: true;
      digest: string;
      manifest: PatchArtifactManifest;
      manifestPath: string;
      diffPath: string;
      normalizedPaths: string[];
    }
  | {
      ok: false;
      reason: string;
      reasons?: string[];
    };

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function sanitizeRunId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }
  return trimmed.replace(/[^A-Za-z0-9._-]/g, "_");
}

function mapManifestFiles(files: ParsedPatchFile[]): PatchArtifactManifestFile[] {
  return [...files]
    .map((file) => ({
      path: file.normalizedPath,
      operation: file.operation,
      added: file.added,
      removed: file.removed,
      binary: file.binary,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function buildPatchArtifactManifest(params: {
  runId: string;
  diffText: string;
  policy: PatchPolicy;
}):
  | { ok: true; digest: string; manifest: PatchArtifactManifest; normalizedPaths: string[] }
  | { ok: false; reason: string; reasons?: string[] } {
  const runId = sanitizeRunId(params.runId);
  if (!runId) {
    return { ok: false, reason: "patch_run_id_invalid" };
  }

  const validation = validateUnifiedDiffAgainstPolicy(params.diffText, params.policy);
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      reasons: validation.decision?.reasons,
    };
  }

  const digest = sha256Hex(params.diffText);
  const parsed = validation.parsed;
  const files = mapManifestFiles(parsed.files);
  const manifest: PatchArtifactManifest = {
    schema_version: 1,
    run_id: runId,
    patch_sha256: digest,
    file_count: parsed.fileCount,
    total_added: parsed.totalAdded,
    total_removed: parsed.totalRemoved,
    total_loc: parsed.totalLoc,
    files,
  };

  return {
    ok: true,
    digest,
    manifest,
    normalizedPaths: files.map((file) => file.path),
  };
}

export function materializePatchArtifact(params: {
  workspaceRoot: string;
  runId: string;
  diffText: string;
  policy: PatchPolicy;
}): PatchBoundaryResult {
  const built = buildPatchArtifactManifest({
    runId: params.runId,
    diffText: params.diffText,
    policy: params.policy,
  });
  if (!built.ok) {
    return {
      ok: false,
      reason: built.reason,
      reasons: built.reasons,
    };
  }

  const patchDir = join(params.workspaceRoot, ".Aegis", "runs", built.manifest.run_id, "patches");
  mkdirSync(patchDir, { recursive: true });

  const baseName = `patch-${built.digest.slice(0, 16)}`;
  const diffPath = join(patchDir, `${baseName}.diff`);
  const manifestPath = join(patchDir, `${baseName}.manifest.json`);

  writeFileSync(diffPath, params.diffText.endsWith("\n") ? params.diffText : `${params.diffText}\n`, "utf-8");
  writeFileSync(manifestPath, `${JSON.stringify(built.manifest, null, 2)}\n`, "utf-8");

  return {
    ok: true,
    digest: built.digest,
    manifest: built.manifest,
    manifestPath: relative(params.workspaceRoot, manifestPath),
    diffPath: relative(params.workspaceRoot, diffPath),
    normalizedPaths: built.normalizedPaths,
  };
}

export interface SandboxedWorkerSuccess<T> {
  ok: true;
  runID: string;
  sandboxCwd: string;
  sandboxStrategy: "worktree" | "clone";
  baseRevision: string;
  workerResult: T;
  patchDiffRef: string;
  manifestRef: string;
  manifest: SandboxManifestRecord;
}

export interface SandboxedWorkerFailure {
  ok: false;
  runID: string;
  reason: string;
  fallbackDenied: true;
}

export type SandboxedWorkerResult<T> = SandboxedWorkerSuccess<T> | SandboxedWorkerFailure;

function collectSandboxDiff(sandboxCwd: string): string {
  const out = spawnSync("git", ["diff", "--binary", "--no-color"], {
    cwd: sandboxCwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  });

  if (out.status !== 0) {
    const stderr = out.stderr ?? "";
    throw new Error(`failed to collect sandbox diff: ${stderr.trim() || "git diff exited non-zero"}`);
  }
  return out.stdout ?? "";
}

export async function executePatchBoundaryWorker<T>(params: {
  repositoryDir: string;
  workerName: string;
  worker: (input: { cwd: string; runID: string; baseRevision: string }) => Promise<T> | T;
  runID?: string;
  baseRevision?: string;
  strategy?: SandboxStrategyMode;
  patchPolicy?: PatchPolicy;
}): Promise<SandboxedWorkerResult<T>> {
  let lifecycle: SandboxLifecycle;
  try {
    lifecycle = createSandboxLifecycle({
      repositoryDir: params.repositoryDir,
      runID: params.runID,
      baseRevision: params.baseRevision,
      strategy: params.strategy,
    });
  } catch (error) {
    return {
      ok: false,
      runID: params.runID?.trim() || "",
      reason: error instanceof Error ? error.message : String(error),
      fallbackDenied: true,
    };
  }

  let cleanedUp = false;
  try {
    const workerResult = await params.worker({
      cwd: lifecycle.sandboxPath,
      runID: lifecycle.runID,
      baseRevision: lifecycle.baseRevision,
    });

    const diffText = collectSandboxDiff(lifecycle.sandboxPath);
    if (!params.patchPolicy) {
      throw new Error("sandbox patch materialization failed: patch_policy_missing");
    }
    const patchMaterialized = materializePatchArtifact({
      workspaceRoot: lifecycle.repoRoot,
      runId: lifecycle.runID,
      diffText,
      policy: params.patchPolicy,
    });
    if (!patchMaterialized.ok) {
      throw new Error(`sandbox patch materialization failed: ${patchMaterialized.reason}`);
    }

    lifecycle.cleanup();
    cleanedUp = true;

    const manifestPayload = writeSandboxManifest({
      lifecycle,
      patchDiffRef: patchMaterialized.diffPath,
      cleanedUp,
    });

    return {
      ok: true,
      runID: lifecycle.runID,
      sandboxCwd: lifecycle.sandboxPath,
      sandboxStrategy: lifecycle.strategy,
      baseRevision: lifecycle.baseRevision,
      workerResult,
      patchDiffRef: patchMaterialized.diffPath,
      manifestRef: manifestPayload.manifestRef,
      manifest: manifestPayload.manifest,
    };
  } catch (error) {
    if (!cleanedUp) {
      try {
        lifecycle.cleanup();
      } catch {
      }
    }
    return {
      ok: false,
      runID: lifecycle.runID,
      reason: error instanceof Error ? error.message : String(error),
      fallbackDenied: true,
    };
  }
}
