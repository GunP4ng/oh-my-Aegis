import { type ToolDefinition } from "@opencode-ai/plugin";
type Mode = "CTF" | "BOUNTY";
export declare function createAstGrepTools(params: {
    projectDir: string;
    getMode: (sessionID: string) => Mode;
    timeoutMs?: number;
}): Record<string, ToolDefinition>;
export {};
