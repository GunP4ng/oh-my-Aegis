export interface DenyRule {
    raw: string;
    re: RegExp;
}
export interface ClaudeRuleEntry {
    sourcePath: string;
    relPath: string;
    body: string;
    pathGlobs: string[];
    pathRes: RegExp[];
}
export interface ClaudeDenyCacheData {
    lastLoadAt: number;
    sourceMtimeMs: number;
    sourcePaths: string[];
    denyBash: DenyRule[];
    denyRead: DenyRule[];
    denyEdit: DenyRule[];
    warnings: string[];
}
export interface ClaudeRulesCacheData {
    lastLoadAt: number;
    sourceMtimeMs: number;
    rules: ClaudeRuleEntry[];
    warnings: string[];
}
export declare class ClaudeRulesCache {
    private directory;
    private denyCache;
    private rulesCache;
    constructor(directory: string);
    getDenyRules(): ClaudeDenyCacheData;
    getRules(): ClaudeRulesCacheData;
    private loadDenyRules;
    private loadRules;
    static parseFrontmatterPaths(text: string): {
        body: string;
        paths: string[];
    };
}
