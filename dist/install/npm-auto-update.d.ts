export type NpmAutoUpdateStatus = "disabled" | "no_install_dir" | "no_package_json" | "throttled" | "up_to_date" | "updated" | "failed";
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
declare function run(command: string, args: string[], cwd: string, timeoutMs: number): RunResult;
export declare function isNpmAutoUpdateEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function resolveOpencodeConfigDir(env?: NodeJS.ProcessEnv): string;
export declare function maybeNpmAutoUpdatePackage(options: {
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
}): Promise<NpmAutoUpdateResult>;
export {};
