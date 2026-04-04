import { type ToolDefinition } from "@opencode-ai/plugin";
export declare function resolveAegisBashInvocation(command: string, options?: {
    platform?: NodeJS.Platform;
    hasAbsoluteBash?: boolean;
}): {
    command: string;
    args: string[];
};
export declare function createClaudeSafeBashTool(projectDir: string): ToolDefinition;
