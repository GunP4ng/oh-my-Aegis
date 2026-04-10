import { describe, expect, it } from "bun:test";
import { handleTextComplete } from "../src/hooks/text-complete-hook";

const recoveryConfig = {
  recovery: {
    enabled: true,
    thinking_block_validator: true,
    empty_message_sanitizer: true,
  },
} as const;

describe("handleTextComplete", () => {
  it("falls back to empty-message recovery when thinking-block sanitization empties the message", () => {
    const result = handleTextComplete({
      text: "thinking:",
      config: recoveryConfig as any,
    });

    expect(result).toEqual({
      text: "[oh-my-Aegis recovery] Empty message recovered. Please retry the last step.",
      action: "empty_message",
    });
  });
});
