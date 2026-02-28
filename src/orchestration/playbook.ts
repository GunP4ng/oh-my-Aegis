import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import { loadPlaybookRegistry } from "./playbook-loader";
import {
  buildPlaybookContext,
  matchesPlaybookRule,
  renderPlaybookTemplate,
} from "./playbook-engine";

export function buildTaskPlaybook(state: SessionState, config: OrchestratorConfig): string {
  const header = "[oh-my-Aegis domain-playbook]";
  const context = buildPlaybookContext(state, config);
  const registry = loadPlaybookRegistry();

  const baseRule = registry.base_rules.find((entry) => matchesPlaybookRule(entry, context));
  const lines = [header, `mode=${state.mode}`, `target=${state.targetType}`, "rules:"];

  if (baseRule) {
    for (const text of baseRule.lines) {
      lines.push(`- ${renderPlaybookTemplate(text, context)}`);
    }
  }

  for (const rule of registry.conditional_rules) {
    if (!matchesPlaybookRule(rule, context)) {
      continue;
    }
    for (const text of rule.lines) {
      lines.push(`- ${renderPlaybookTemplate(text, context)}`);
    }
  }

  return lines.join("\n");
}

export function hasPlaybookMarker(prompt: string): boolean {
  return prompt.includes("[oh-my-Aegis domain-playbook]");
}
