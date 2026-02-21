import { AGENT_OVERRIDES } from "./agent-overrides";
export { AGENT_OVERRIDES };
export interface ApplyAegisConfigOptions {
    pluginEntry: string;
    opencodeDirOverride?: string;
    environment?: NodeJS.ProcessEnv;
    backupExistingConfig?: boolean;
    antigravityAuthPluginEntry?: string;
    openAICodexAuthPluginEntry?: string;
    ensureAntigravityAuthPlugin?: boolean;
    ensureOpenAICodexAuthPlugin?: boolean;
    ensureGoogleProviderCatalog?: boolean;
    ensureOpenAIProviderCatalog?: boolean;
    ensureAnthropicProviderCatalog?: boolean;
}
export interface ApplyAegisConfigResult {
    opencodePath: string;
    aegisPath: string;
    backupPath: string | null;
    pluginEntry: string;
    addedAgents: string[];
    ensuredBuiltinMcps: string[];
}
export interface ResolveLatestPackageVersionOptions {
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
    timeoutMs?: number;
}
export declare function resolveLatestPackageVersion(packageName: string, options?: ResolveLatestPackageVersionOptions): Promise<string | null>;
export declare function resolveAntigravityAuthPluginEntry(options?: ResolveLatestPackageVersionOptions): Promise<string>;
export declare function resolveOpenAICodexAuthPluginEntry(options?: ResolveLatestPackageVersionOptions): Promise<string>;
export declare function resolveOpencodeDir(environment?: NodeJS.ProcessEnv): string;
export declare function resolveOpencodeConfigPath(opencodeDir: string): string;
export declare function applyAegisConfig(options: ApplyAegisConfigOptions): ApplyAegisConfigResult;
