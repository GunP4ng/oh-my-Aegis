import type { OrchestratorConfig } from "../config/schema";
import type { Mode } from "../state/types";
import { sanitizeCommand } from "./sanitize";
import type { BountyScopePolicy } from "../bounty/scope-policy";
import { hostMatchesPolicy, isInBlackout } from "../bounty/scope-policy";

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
  sanitizedCommand?: string;
  denyLevel?: "hard" | "soft";
}

export function evaluateBashCommand(
  command: string,
  config: OrchestratorConfig,
  mode: Mode,
  options?: { scopeConfirmed?: boolean; scopePolicy?: BountyScopePolicy | null; now?: Date }
): PolicyDecision {
  const containsNewline = /[\r\n]/.test(command);
  const sanitized = sanitizeCommand(command);

  const deny = (denyLevel: "hard" | "soft", reason: string): PolicyDecision => {
    return {
      allow: false,
      reason,
      sanitizedCommand: sanitized,
      denyLevel,
    };
  };
  const denyHard = (reason: string): PolicyDecision => deny("hard", reason);
  const denySoft = (reason: string): PolicyDecision => deny("soft", reason);

  const readonlySegmentsBlockedReason = (reason: string): PolicyDecision => {
    return denyHard(reason);
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

  if (mode === "BOUNTY") {
    if (config.bounty_policy.deny_scanner_commands) {
      for (const pattern of config.bounty_policy.scanner_command_patterns) {
        let expression: RegExp;
        try {
          expression = new RegExp(pattern, "i");
        } catch {
          continue;
        }
        if (expression.test(sanitized)) {
          return denySoft(`BOUNTY guardrail blocked scanner/automation pattern: ${pattern}`);
        }
      }
    }

    const scopePolicy = options?.scopePolicy ?? null;
    const now = options?.now ?? new Date();
    const enforceBlackout = config.bounty_policy.enforce_blackout_windows;
    const enforceAllowedHosts = config.bounty_policy.enforce_allowed_hosts;

    const urlHosts = extractUrlHosts(sanitized);
    const networkHosts = extractNetworkHosts(sanitized);
    const hostsToCheck = [...new Set([...urlHosts, ...networkHosts])];

    if (enforceBlackout && scopePolicy && scopePolicy.blackoutWindows.length > 0) {
      if (hostsToCheck.length > 0 && isInBlackout(now, scopePolicy.blackoutWindows)) {
        return denySoft("BOUNTY guardrail blocked network command during blackout window.");
      }
    }

    if (options?.scopeConfirmed === true && enforceAllowedHosts && scopePolicy && hostsToCheck.length > 0) {
      for (const host of hostsToCheck) {
        const verdict = hostMatchesPolicy(host, scopePolicy);
        if (!verdict.allowed) {
          return denySoft(
            `BOUNTY guardrail blocked out-of-scope host '${host}' (${verdict.reason ?? "policy"}).`
          );
        }
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
      return denyHard(`${mode} guardrail blocked destructive command pattern: ${pattern}`);
    }
  }

  return {
    allow: true,
    sanitizedCommand: sanitized,
  };
}

function extractUrlHosts(command: string): string[] {
  const hosts: string[] = [];
  const re = /https?:\/\/[^\s"']+/gi;
  const matches = command.match(re) ?? [];
  for (const raw of matches) {
    try {
      const u = new URL(raw);
      if (u.hostname) {
        hosts.push(u.hostname);
      }
    } catch {
      continue;
    }
  }
  return hosts;
}

function isIPv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (!Number.isFinite(n) || n < 0 || n > 255) return false;
  }
  return true;
}

function isIPv6(value: string): boolean {
  if (!value.includes(":")) return false;
  return /^[0-9a-f:]+$/i.test(value);
}

function normalizeHostToken(rawToken: string): string {
  const trimmed = rawToken.replace(/^[`'"\(\{<]+|[`'"\)\}>.,;:]+$/g, "");
  if (!trimmed) return "";

  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    const close = trimmed.indexOf("]");
    const inside = trimmed.slice(1, close);
    return inside;
  }

  let token = trimmed.replace(/^\[+|\]+$/g, "");

  const at = token.lastIndexOf("@");
  if (at >= 0 && at < token.length - 1) {
    token = token.slice(at + 1);
  }

  if (token.includes(":") && token.indexOf(":") === token.lastIndexOf(":")) {
    const maybePort = token.slice(token.lastIndexOf(":") + 1);
    if (/^\d{1,5}$/.test(maybePort)) {
      token = token.slice(0, token.lastIndexOf(":"));
    }
  }

  return token.toLowerCase();
}

function extractNetworkHosts(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) return [];
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) return [];
  const tool = tokens[0].toLowerCase();
  const networkTools = new Set([
    "curl",
    "wget",
    "http",
    "https",
    "ping",
    "dig",
    "nslookup",
    "traceroute",
    "nc",
    "netcat",
    "telnet",
    "ssh",
  ]);
  if (!networkTools.has(tool)) return [];

  const hosts = new Set<string>();

  for (let i = 1; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t) continue;
    if (t.startsWith("-")) continue;

    const candidates = t.split(",").map((item) => item.trim()).filter(Boolean);
    for (const candidate of candidates) {
      if (/^https?:\/\//i.test(candidate)) {
        try {
          const host = new URL(candidate).hostname;
          if (host) {
            hosts.add(host.toLowerCase());
          }
        } catch {
          continue;
        }
        continue;
      }

      const host = normalizeHostToken(candidate);
      if (!host) continue;
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) || isIPv4(host) || isIPv6(host)) {
        hosts.add(host);
      }
    }
  }

  return [...hosts];
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
