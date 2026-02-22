export type AutoUpdateStatus = "disabled" | "not_git_repo" | "no_upstream" | "throttled" | "up_to_date" | "dirty_worktree" | "diverged" | "updated" | "failed";
export interface AutoUpdateResult {
    status: AutoUpdateStatus;
    repoRoot: string | null;
    detail: string;
}
export declare function isAutoUpdateEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function findGitRepoRoot(startDir: string): string | null;
export declare function maybeAutoUpdate(options?: {
    force?: boolean;
    silent?: boolean;
}): Promise<AutoUpdateResult>;
export declare function runUpdate(commandArgs?: string[]): Promise<number>;
