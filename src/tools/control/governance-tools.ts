import type { ToolDefinition } from "@opencode-ai/plugin";
import { pickToolsByID } from "./pick-tools-by-id";

export const createGovernanceTools = (
  registry: Record<string, ToolDefinition>
): Record<string, ToolDefinition> =>
  pickToolsByID(registry, ["ctf_patch_propose", "ctf_patch_review", "ctf_patch_apply", "ctf_patch_audit"]);
