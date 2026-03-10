import type { ToolDefinition } from "@opencode-ai/plugin";
import { pickToolsByID } from "./pick-tools-by-id";

export const createMemoryTools = (
  registry: Record<string, ToolDefinition>
): Record<string, ToolDefinition> =>
  pickToolsByID(registry, [
    "aegis_memory_save",
    "aegis_memory_search",
    "aegis_memory_list",
    "aegis_memory_delete",
    "aegis_think",
  ]);
