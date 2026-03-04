import { type PatchPolicy, type PatchOperation } from "../risk/patch-policy";
import { type SandboxManifestRecord, type SandboxStrategyMode } from "./sandbox";
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
export type PatchBoundaryResult = {
    ok: true;
    digest: string;
    manifest: PatchArtifactManifest;
    manifestPath: string;
    diffPath: string;
    normalizedPaths: string[];
} | {
    ok: false;
    reason: string;
    reasons?: string[];
};
export declare function buildPatchArtifactManifest(params: {
    runId: string;
    diffText: string;
    policy: PatchPolicy;
}): {
    ok: true;
    digest: string;
    manifest: PatchArtifactManifest;
    normalizedPaths: string[];
} | {
    ok: false;
    reason: string;
    reasons?: string[];
};
export declare function materializePatchArtifact(params: {
    workspaceRoot: string;
    runId: string;
    diffText: string;
    policy: PatchPolicy;
}): PatchBoundaryResult;
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
export declare function executePatchBoundaryWorker<T>(params: {
    repositoryDir: string;
    workerName: string;
    worker: (input: {
        cwd: string;
        runID: string;
        baseRevision: string;
    }) => Promise<T> | T;
    runID?: string;
    baseRevision?: string;
    strategy?: SandboxStrategyMode;
    patchPolicy?: PatchPolicy;
}): Promise<SandboxedWorkerResult<T>>;
