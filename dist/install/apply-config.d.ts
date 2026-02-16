import { AGENT_OVERRIDES } from "./agent-overrides";
export { AGENT_OVERRIDES };
export interface ApplyAegisConfigOptions {
    pluginEntry: string;
    opencodeDirOverride?: string;
    environment?: NodeJS.ProcessEnv;
    backupExistingConfig?: boolean;
}
export interface ApplyAegisConfigResult {
    opencodePath: string;
    aegisPath: string;
    backupPath: string | null;
    pluginEntry: string;
    addedAgents: string[];
    ensuredBuiltinMcps: string[];
}
export declare function resolveOpencodeDir(environment?: NodeJS.ProcessEnv): string;
export declare function applyAegisConfig(options: ApplyAegisConfigOptions): ApplyAegisConfigResult;
