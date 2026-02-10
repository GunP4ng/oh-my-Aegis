export { BuiltinMcpNameSchema, type BuiltinMcpName, type AnyMcpName, AnyMcpNameSchema } from "./types";
export declare function createBuiltinMcps(disabledMcps?: string[]): Record<string, {
    type: "remote";
    url: string;
    enabled: boolean;
}>;
