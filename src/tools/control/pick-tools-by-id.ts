import type { ToolDefinition } from "@opencode-ai/plugin";

export const pickToolsByID = (
  registry: Record<string, ToolDefinition>,
  toolIDs: readonly string[],
): Record<string, ToolDefinition> => {
  const selected: Record<string, ToolDefinition> = {};
  for (const toolID of toolIDs) {
    selected[toolID] = registry[toolID];
  }
  return selected;
};
