import type { OrchestratorConfig } from "../config/schema";
import { sanitizeThinkingBlocks } from "../risk/sanitize";

export interface TextCompleteInput {
  text: string;
  config: OrchestratorConfig;
}

export interface TextCompleteResult {
  /** null means no change; otherwise the sanitized text. */
  text: string | null;
  /** Which sanitizer fired, if any. */
  action: "thinking_block" | "empty_message" | null;
}

/**
 * Pure logic for the `experimental.text.complete` hook.
 *
 * Returns `null` text when no modification is needed, or the replacement text
 * together with which action was taken.
 */
export function handleTextComplete(params: TextCompleteInput): TextCompleteResult {
  let candidateText = params.text;

  if (params.config.recovery.enabled && params.config.recovery.thinking_block_validator) {
    const fixed = sanitizeThinkingBlocks(params.text);
    if (fixed !== null) {
      candidateText = fixed;
      if (!params.config.recovery.empty_message_sanitizer || candidateText.trim().length > 0) {
        return { text: candidateText, action: "thinking_block" };
      }
    }
  }

  if (!params.config.recovery.enabled || !params.config.recovery.empty_message_sanitizer) {
    return { text: null, action: null };
  }

  if (candidateText.trim().length > 0) {
    return { text: null, action: null };
  }

  return {
    text: "[oh-my-Aegis recovery] Empty message recovered. Please retry the last step.",
    action: "empty_message",
  };
}
