import { type ToolDefinition } from "@opencode-ai/plugin";
type Mode = "CTF" | "BOUNTY";
type SgRunArgs = {
    pattern: string;
    rewrite?: string;
    updateAll?: boolean;
    lang?: string;
    paths?: string[];
    globs?: string[];
    selector?: string;
    strictness?: "cst" | "smart" | "ast" | "relaxed" | "signature" | "template";
    context?: number;
    output?: "text" | "json";
};
export declare function buildSgRunCommand(args: {
    pattern: string;
    rewrite?: string;
    updateAll?: boolean;
    lang?: string;
    selector?: string;
    strictness?: SgRunArgs["strictness"];
    context?: number;
    output?: SgRunArgs["output"];
    globs?: string[];
    paths: string[];
}): string[];
export declare function createAstGrepTools(params: {
    projectDir: string;
    getMode: (sessionID: string) => Mode;
    timeoutMs?: number;
}): Record<string, ToolDefinition>;
export {};
