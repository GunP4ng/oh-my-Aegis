import type { ToolDefinition } from "@opencode-ai/plugin";
import { pickToolsByID } from "./pick-tools-by-id";

export const createChannelTools = (
  registry: Record<string, ToolDefinition>
): Record<string, ToolDefinition> =>
  pickToolsByID(registry, ["ctf_orch_channel_publish", "ctf_orch_channel_read"]);
