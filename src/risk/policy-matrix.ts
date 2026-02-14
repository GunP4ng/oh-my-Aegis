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
  const containsNewline = /[\r\n]/.test(command);
  const sanitized = sanitizeCommand(command);

  const readonlySegmentsBlockedReason = (reason: string): PolicyDecision => {
    return {
      allow: false,
      reason,
      sanitizedCommand: sanitized,
    };
  };

  const splitReadonlySegments = (input: string): string[] => {
    return input
      .split(/\s*(?:\|\||&&|;|\|)\s*/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  };

  const hasForbiddenReadonlyShellSyntax = (segment: string): boolean => {
    if (/[<>]/.test(segment)) return true;
    if (segment.includes("`")) return true;
    if (segment.includes("$(")) return true;

    if (/\b(sudo|doas)\b/i.test(segment)) return true;

    if (/^find(\s|$)/i.test(segment)) {
      if (/(\s|^)-(delete|execdir|exec|okdir|ok)(\s|$)/i.test(segment)) return true;
    }

    return false;
  };

  if (mode === "BOUNTY" && options?.scopeConfirmed !== true) {
    if (containsNewline) {
      return readonlySegmentsBlockedReason(
        "BOUNTY guardrail blocked multi-line command before scope confirmation."
      );
    }

    const segments = splitReadonlySegments(sanitized);
    if (segments.length === 0) {
      return readonlySegmentsBlockedReason(
        "BOUNTY guardrail blocked empty command before scope confirmation."
      );
    }

    for (const segment of segments) {
      if (hasForbiddenReadonlyShellSyntax(segment)) {
        return readonlySegmentsBlockedReason(
          "BOUNTY guardrail blocked unsafe shell syntax before scope confirmation."
        );
      }

      const segmentAllowed = config.guardrails.bounty_scope_readonly_patterns.some((pattern) => {
        try {
          return new RegExp(pattern, "i").test(segment);
        } catch {
          return false;
        }
      });

      if (!segmentAllowed) {
        return readonlySegmentsBlockedReason(
          "BOUNTY guardrail blocked non-read-only command before scope confirmation."
        );
      }
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
