export interface FetchNpmDistTagsOptions {
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
    timeoutMs?: number;
}
export declare function fetchNpmDistTags(packageName: string, options?: FetchNpmDistTagsOptions): Promise<Record<string, string> | null>;
export declare function resolvePluginEntryWithVersion(packageName: string, currentVersion: string, options?: FetchNpmDistTagsOptions): Promise<string>;
