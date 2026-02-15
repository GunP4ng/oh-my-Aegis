import { describe, expect, it } from "bun:test";
import { extractErrorMessage, extractMessageIndexFromError } from "../src/recovery/error-utils";
import { parseModelId } from "../src/recovery/model-id";
import { detectSessionRecoveryErrorType } from "../src/recovery/session-recovery";

describe("recovery/error-utils", () => {
  it("extractErrorMessage handles string", () => {
    expect(extractErrorMessage("hello")).toBe("hello");
  });

  it("extractErrorMessage handles Error", () => {
    expect(extractErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("extractErrorMessage handles nested shapes", () => {
    const err = { data: { error: { message: "nested" } } };
    expect(extractErrorMessage(err)).toBe("nested");
  });

  it("extractMessageIndexFromError extracts index", () => {
    const err = { message: "Invalid: messages.12 must start with thinking" };
    expect(extractMessageIndexFromError(err)).toBe(12);
  });
});

describe("recovery/model-id", () => {
  it("parses provider/model", () => {
    expect(parseModelId("openai/gpt-5.3-codex")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.3-codex",
    });
  });

  it("handles missing slash", () => {
    expect(parseModelId("gpt-5.3-codex")).toEqual({
      providerID: "unknown",
      modelID: "gpt-5.3-codex",
    });
  });

  it("handles empty input", () => {
    expect(parseModelId("")).toEqual({ providerID: "unknown", modelID: "" });
  });
});

describe("recovery/session-recovery detector", () => {
  it("detects tool_result_missing", () => {
    const msg = "Expected tool_result for tool_use but found none";
    expect(detectSessionRecoveryErrorType(msg)).toBe("tool_result_missing");
  });

  it("detects thinking_disabled_violation", () => {
    const msg = "Thinking is disabled and cannot contain reasoning";
    expect(detectSessionRecoveryErrorType(msg)).toBe("thinking_disabled_violation");
  });

  it("detects thinking_block_order", () => {
    const msg = "Expected thinking but found tool_use";
    expect(detectSessionRecoveryErrorType(msg)).toBe("thinking_block_order");
  });

  it("returns null for unrelated errors", () => {
    expect(detectSessionRecoveryErrorType("some random error")).toBeNull();
  });
});
