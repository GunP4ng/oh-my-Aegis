export type BlackoutWindow = {
    day: number;
    startMinutes: number;
    endMinutes: number;
};
export type BountyScopePolicy = {
    sourcePath: string;
    sourceMtimeMs: number;
    allowedHostsExact: string[];
    allowedHostsSuffix: string[];
    deniedHostsExact: string[];
    deniedHostsSuffix: string[];
    blackoutWindows: BlackoutWindow[];
    warnings: string[];
};
export type ScopeDocLoadResult = {
    ok: true;
    policy: BountyScopePolicy;
} | {
    ok: false;
    reason: string;
    warnings: string[];
};
export type ScopeDocConfig = {
    candidates: string[];
    includeApexForWildcardAllow: boolean;
};
export declare function parseScopeMarkdown(markdown: string, sourcePath: string, mtimeMs: number, options?: {
    includeApexForWildcardAllow?: boolean;
}): BountyScopePolicy;
export declare function resolveScopeDocCandidates(projectDir: string, config?: Partial<ScopeDocConfig>): string[];
export declare function loadScopePolicyFromWorkspace(projectDir: string, config?: Partial<ScopeDocConfig>): ScopeDocLoadResult;
export declare function hostMatchesPolicy(host: string, policy: Pick<BountyScopePolicy, "allowedHostsExact" | "allowedHostsSuffix" | "deniedHostsExact" | "deniedHostsSuffix">): {
    allowed: boolean;
    reason?: string;
};
export declare function isInBlackout(now: Date, windows: BlackoutWindow[]): boolean;
