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
export declare function createSandboxLifecycle(params: {
    repositoryDir: string;
    runID?: string;
    baseRevision?: string;
    strategy?: SandboxStrategyMode;
}): SandboxLifecycle;
export declare function writeSandboxManifest(params: {
    lifecycle: SandboxLifecycle;
    patchDiffRef: string;
    cleanedUp: boolean;
}): {
    manifestPath: string;
    manifestRef: string;
    manifest: SandboxManifestRecord;
};
