import type { FailureReason } from "../state/types";

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function stripAnsi(input: string): string {
  return input.replace(new RegExp(String.raw`\\x1B\\[[0-9;]*m`, "g"), "");
}

export function sanitizeCommand(input: string): string {
  return normalizeWhitespace(stripAnsi(input));
}

export function isLikelyTimeout(output: string): boolean {
  const text = output.toLowerCase();
  return text.includes("timed out") || text.includes("timeout") || text.includes("deadline exceeded");
}

export function isContextLengthFailure(output: string): boolean {
  const text = output.toLowerCase();
  return (
    text.includes("context_length_exceeded") ||
    text.includes("maximum context length") ||
    text.includes("invalid_request_error") ||
    text.includes("messageoutputlengtherror")
  );
}

export function isTokenOrQuotaFailure(output: string): boolean {
  const text = output.toLowerCase();
  return (
    text.includes("insufficient_quota") ||
    text.includes("quota exceeded") ||
    text.includes("out of credits") ||
    text.includes("token limit") ||
    text.includes("rate limit") ||
    text.includes("rate_limit_exceeded") ||
    text.includes("status 429") ||
    text.includes("provider model not found") ||
    text.includes("providermodelnotfounderror")
  );
}

export function isRetryableTaskFailure(output: string): boolean {
  return isContextLengthFailure(output) || isLikelyTimeout(output) || isTokenOrQuotaFailure(output);
}

export function classifyFailureReason(output: string): FailureReason | null {
  const text = output.toLowerCase();

  if (/(?:\bunsat\b|unsatisfiable|unsatisfiable\s+constraints|constraints\s+unsat)/i.test(text)) {
    return "unsat_claim";
  }

  if (
    /(?:static\s*\/\s*dynamic|static\s+analysis|dynamic\s+analysis|runtime).*?(?:contradict|mismatch|inconsistent)|(?:contradict|mismatch|inconsistent).*?(?:static\s*\/\s*dynamic|static\s+analysis|dynamic\s+analysis|runtime)/i.test(
      text
    )
  ) {
    return "static_dynamic_contradiction";
  }

  if (isContextLengthFailure(output)) {
    return "context_overflow";
  }
  if (isLikelyTimeout(output) || isTokenOrQuotaFailure(output)) {
    return "tooling_timeout";
  }
  if (isVerifyFailure(output)) {
    return "verification_mismatch";
  }
  if (
    /(segmentation fault|sigsegv|stack smashing|core dumped|double free|abort trap|assertion failed|fatal signal|crash)/i.test(
      text
    )
  ) {
    return "exploit_chain";
  }
  if (
    /(permission denied|operation not permitted|no such file|command not found|failed to spawn|exec format error|connection refused)/i.test(
      text
    )
  ) {
    return "environment";
  }
  if (
    /(no new evidence|no-new-evidence|same payload|same-payload|inconclusive|\bhypothesis\s+stall\b|\bstuck\b)/i.test(
      text
    )
  ) {
    return "hypothesis_stall";
  }
  return null;
}

const INJECTION_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "ignore_instructions", pattern: /ignore\s+(all\s+)?(previous|prior|system|developer)\s+instructions/i },
  { id: "reveal_prompt", pattern: /(show|reveal|print|dump)\s+(the\s+)?(system|developer)\s+prompt/i },
  { id: "prompt_override", pattern: /(you\s+must|do\s+exactly|follow\s+only)\s+.*(instead|not\s+the\s+rules)/i },
  { id: "exact_command", pattern: /run\s+this\s+exact\s+command/i },
  { id: "policy_bypass", pattern: /bypass\s+(safety|policy|guardrail|restriction)/i },
];

export function detectInjectionIndicators(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }
  const matches: string[] = [];
  for (const item of INJECTION_PATTERNS) {
    if (item.pattern.test(text)) {
      matches.push(item.id);
    }
  }
  return matches;
}

export function isVerificationSourceRelevant(
  toolName: string,
  title: string | null | undefined,
  options: { verifierToolNames: string[]; verifierTitleMarkers: string[] }
): boolean {
  const normalizedToolName = toolName.toLowerCase();
  const normalizedTitle = (title ?? "").toLowerCase();
  const markerMatchedInTitle = options.verifierTitleMarkers.some((marker) =>
    normalizedTitle.includes(marker.toLowerCase())
  );

  const isConfiguredVerifierTool = options.verifierToolNames.some(
    (name) => name.toLowerCase() === normalizedToolName
  );

  if (!isConfiguredVerifierTool) {
    return markerMatchedInTitle;
  }

  if (normalizedToolName === "task" || normalizedToolName === "bash") {
    return markerMatchedInTitle;
  }

  return true;
}

const VERIFY_FAIL_STRICT_RE =
  /\b(?:wrong\s+answer|invalid\s+flag|rejected|incorrect|not\s+(?:flag\s+)?accepted|unaccepted|not\s+correct)\b/i;

const VERIFY_FAIL_GENERIC_RE = /\b(?:wrong!?|wrong\s+answer|incorrect|rejected|invalid\s+flag)\b/i;

const VERIFY_SUCCESS_STRICT_RE = /\b(?:flag\s+accepted|accepted!|correct!?)\b/i;
const VERIFY_SUCCESS_GENERIC_RE = /\b(?:accepted|correct!?)\b/i;

export function isVerifySuccess(output: string): boolean {
  const text = normalizeWhitespace(stripAnsi(output));
  if (VERIFY_FAIL_STRICT_RE.test(text)) {
    return false;
  }
  return VERIFY_SUCCESS_STRICT_RE.test(text) || VERIFY_SUCCESS_GENERIC_RE.test(text);
}

export function isVerifyFailure(output: string): boolean {
  const text = normalizeWhitespace(stripAnsi(output));
  return VERIFY_FAIL_STRICT_RE.test(text) || VERIFY_FAIL_GENERIC_RE.test(text);
}

/**
 * Non-Interactive Environment guard.
 * Detects bash commands that would open an interactive editor or prompt,
 * causing an indefinite hang in a headless/CI environment.
 *
 * Returns a human-readable reason if the command is interactive, or null if safe.
 */
const INTERACTIVE_COMMAND_PATTERNS: Array<{ id: string; pattern: RegExp; reason: string }> = [
  { id: "git_rebase_i", pattern: /\bgit\s+rebase\s+(-[a-zA-Z]*i|--interactive)\b/, reason: "git rebase -i opens an interactive editor" },
  { id: "git_add_i", pattern: /\bgit\s+add\s+(-[a-zA-Z]*i|--interactive|-[a-zA-Z]*p|--patch)\b/, reason: "git add -i/--patch opens interactive prompts" },
  { id: "git_commit_no_msg", pattern: /\bgit\s+commit\b(?!.*(-m\s|--message[ =]))/, reason: "git commit without -m opens an editor; use -m 'msg'" },
  { id: "editor_vim", pattern: /\b(vim?|nvim|nano|emacs|pico|joe|micro)\b/, reason: "Interactive editor detected; use non-interactive alternatives" },
  { id: "less_more", pattern: /\|\s*(less|more)\s*$/, reason: "Pager detected; output will hang. Remove pipe to less/more" },
  { id: "interactive_python", pattern: /\bpython3?\s*$/, reason: "Bare python opens REPL; provide a script or use -c" },
  { id: "interactive_node", pattern: /\bnode\s*$/, reason: "Bare node opens REPL; provide a script or use -e" },
  { id: "ssh_no_cmd", pattern: /\bssh\s+[^|;&]+$/, reason: "ssh without a command opens an interactive shell" },
  { id: "interactive_flag", pattern: /\b(bash|sh|zsh)\s+(-[a-zA-Z]*i|--interactive)\b/, reason: "Interactive shell flag detected" },
];

export function detectInteractiveCommand(command: string): { id: string; reason: string } | null {
  const cleaned = sanitizeCommand(command);
  for (const entry of INTERACTIVE_COMMAND_PATTERNS) {
    if (entry.pattern.test(cleaned)) {
      return { id: entry.id, reason: entry.reason };
    }
  }
  return null;
}

/**
 * Thinking Block Validator.
 * Detects malformed thinking block structures in model output that would
 * cause downstream parsing errors.
 *
 * Returns the sanitized text if a fix was applied, or null if no issue found.
 */
export function sanitizeThinkingBlocks(text: string): string | null {
  if (!text || text.trim().length === 0) {
    return null;
  }

  let modified = false;
  let result = text;

  // Fix 1: Unclosed <thinking> tags
  const openCount = (result.match(/<thinking>/gi) || []).length;
  const closeCount = (result.match(/<\/thinking>/gi) || []).length;
  if (openCount > closeCount) {
    const diff = openCount - closeCount;
    for (let i = 0; i < diff; i++) {
      result = `${result}\n</thinking>`;
    }
    modified = true;
  }

  // Fix 2: Orphaned </thinking> without matching <thinking>
  if (closeCount > openCount) {
    let surplus = closeCount - openCount;
    result = result.replace(/<\/thinking>/gi, (match) => {
      if (surplus > 0) {
        surplus--;
        return "";
      }
      return match;
    });
    modified = true;
  }

  // Fix 3: Thinking content leaked outside tags (model outputs "thinking:" prefix)
  const thinkingPrefixRe = /^(thinking:\s*)/i;
  if (thinkingPrefixRe.test(result.trimStart()) && !result.includes("<thinking>")) {
    result = result.replace(thinkingPrefixRe, "");
    modified = true;
  }

  return modified ? result : null;
}
