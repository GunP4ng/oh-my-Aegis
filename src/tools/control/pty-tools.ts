import type { ToolDefinition } from "@opencode-ai/plugin";
import { pickToolsByID } from "./pick-tools-by-id";

export const createPtyTools = (
  registry: Record<string, ToolDefinition>
): Record<string, ToolDefinition> =>
  pickToolsByID(registry, [
    "ctf_orch_pty_create",
    "ctf_orch_pty_list",
    "ctf_orch_pty_get",
    "ctf_orch_pty_update",
    "ctf_orch_pty_remove",
    "ctf_orch_pty_connect",
  ]);
