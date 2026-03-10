import type { ToolDefinition } from "@opencode-ai/plugin";
export declare const pickToolsByID: (registry: Record<string, ToolDefinition>, toolIDs: readonly string[]) => Record<string, ToolDefinition>;
