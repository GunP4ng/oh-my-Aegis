import { describe, expect, it } from "bun:test";
import { normalizeVariantForModel, resolveAgentExecutionProfile } from "../src/orchestration/model-health";

describe("model health variant normalization", () => {
  it("drops variant for Google provider models outside local model pool", () => {
    expect(normalizeVariantForModel("google/gemini-2.5-pro", "high", "medium")).toBe("");
    expect(normalizeVariantForModel("google/gemini-2.0-flash", "low", "high")).toBe("");
  });

  it("resolves Google execution profile without variant even when requested", () => {
    const profile = resolveAgentExecutionProfile("ctf-web", {
      preferredModel: "google/gemini-2.5-pro",
      preferredVariant: "high",
    });

    expect(profile.model).toBe("google/gemini-2.5-pro");
    expect(profile.variant).toBe("");
  });

  it("uses OpenCode Zen free model as md-scribe default", () => {
    const profile = resolveAgentExecutionProfile("md-scribe");
    expect(profile.model).toBe("opencode/glm-5-free");
    expect(profile.variant).toBe("");
  });
});
