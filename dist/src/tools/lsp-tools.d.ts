import { type ToolDefinition } from "@opencode-ai/plugin";
export declare function createLspTools(params: {
    client: unknown;
    projectDir: string;
}): Record<string, ToolDefinition>;
