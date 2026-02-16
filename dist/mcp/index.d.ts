export { BuiltinMcpNameSchema, type BuiltinMcpName, type AnyMcpName, AnyMcpNameSchema } from "./types";
type RemoteMcpConfig = {
    type: "remote";
    url: string;
    enabled: boolean;
};
type LocalMcpConfig = {
    type: "local";
    command: string[];
    enabled: boolean;
    environment?: Record<string, string>;
};
export type BuiltinMcpConfig = RemoteMcpConfig | LocalMcpConfig;
export declare function createBuiltinMcps(params: {
    projectDir: string;
    disabledMcps?: string[];
    memoryStorageDir?: string;
}): Record<string, BuiltinMcpConfig>;
