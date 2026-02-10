import type { OrchestratorConfig } from "../config/schema";
import type { Mode } from "../state/types";
import { sanitizeCommand } from "./sanitize";

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
  sanitizedCommand?: string;
}

export function evaluateBashCommand(
  command: string,
  config: OrchestratorConfig,
  mode: Mode,
  options?: { scopeConfirmed?: boolean }
): PolicyDecision {
  const sanitized = sanitizeCommand(command);

  if (mode === "BOUNTY" && options?.scopeConfirmed !== true) {
    const isReadonly = config.guardrails.bounty_scope_readonly_patterns.some((pattern) => {
      try {
        return new RegExp(pattern, "i").test(sanitized);
      } catch {
        return false;
      }
    });
    if (!isReadonly) {
      return {
        allow: false,
        reason: "BOUNTY guardrail blocked non-read-only command before scope confirmation.",
        sanitizedCommand: sanitized,
      };
    }
  }

  if (!config.guardrails.deny_destructive_bash) {
    return { allow: true, sanitizedCommand: sanitized };
  }

  for (const pattern of config.guardrails.destructive_command_patterns) {
    let expression: RegExp;
    try {
      expression = new RegExp(pattern, "i");
    } catch {
      continue;
    }
    if (expression.test(sanitized)) {
      return {
        allow: false,
        reason: `${mode} guardrail blocked destructive command pattern: ${pattern}`,
        sanitizedCommand: sanitized,
      };
    }
  }

  return {
    allow: true,
    sanitizedCommand: sanitized,
  };
}

export function extractBashCommand(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") {
    return "";
  }

  const data = metadata as Record<string, unknown>;
  const keys = ["command", "cmd", "input", "arguments"];
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}
