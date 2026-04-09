import type { ToolDefinition } from "@opencode-ai/plugin";
import { createClaudeSafeBashTool, type BashPolicyEvaluator } from "./claude-safe-bash-tool";
import { createClaudeSafeGlobTool } from "./claude-safe-glob-tool";
import { createClaudeSafeReadTool } from "./claude-safe-read-tool";
import { createClaudeSafeSkillTool } from "./claude-safe-skill-tool";
import { createClaudeSafeWebfetchTool } from "./claude-safe-webfetch-tool";

export function createClaudeSafeTools(
  projectDir: string,
  options?: { policyEvaluator?: BashPolicyEvaluator },
): Record<string, ToolDefinition> {
  return {
    aegis_bash: createClaudeSafeBashTool(projectDir, { policyEvaluator: options?.policyEvaluator }),
    aegis_glob: createClaudeSafeGlobTool(projectDir),
    aegis_read: createClaudeSafeReadTool(projectDir),
    aegis_skill: createClaudeSafeSkillTool(projectDir),
    aegis_webfetch: createClaudeSafeWebfetchTool(),
  };
}
