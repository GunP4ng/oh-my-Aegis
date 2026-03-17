import { describe, expect, it } from "bun:test";
import { normalizeVariantForModel, resolveAgentExecutionProfile } from "../src/orchestration/model-health";

describe("model health variant normalization", () => {
  it("drops variant for Google provider models", () => {
    expect(normalizeVariantForModel("google/gemini-2.5-pro", "high", "medium")).toBe("");
    expect(normalizeVariantForModel("google/gemini-3-pro-preview", "low", "high")).toBe("");
  });

  it("resolves Google execution profile without variant even when requested", () => {
    const profile = resolveAgentExecutionProfile("ctf-web", {
      preferredModel: "google/gemini-2.5-pro",
      preferredVariant: "high",
    });

    expect(profile.model).toBe("google/gemini-2.5-pro");
    expect(profile.variant).toBe("");
  });

  it("uses Anthropic Claude model as aegis-plan default", () => {
    const profile = resolveAgentExecutionProfile("aegis-plan");
    expect(profile.model).toBe("anthropic/claude-sonnet-4.5");
    expect(profile.variant).toBe("low");
  });

  it("keeps OpenAI codex high profile for aegis-exec", () => {
    const profile = resolveAgentExecutionProfile("aegis-exec");
    expect(profile.model).toBe("openai/gpt-5.3-codex");
    expect(profile.variant).toBe("high");
  });

  it("supports GPT 5.4 as an OpenAI execution profile", () => {
    const profile = resolveAgentExecutionProfile("ctf-web", {
      preferredModel: "openai/gpt-5.4",
      preferredVariant: "max",
    });

    expect(profile.model).toBe("openai/gpt-5.4");
    expect(profile.variant).toBe("xhigh");
  });

  it("uses Gemini profile for ctf-research and normalizes to empty variant", () => {
    const profile = resolveAgentExecutionProfile("ctf-research");
    expect(profile.model).toBe("google/gemini-3-pro-preview");
    expect(profile.variant).toBe("");
  });

  it("normalizes anthropic variants to low/max", () => {
    expect(normalizeVariantForModel("anthropic/claude-sonnet-4.5", "medium", "low")).toBe("low");
    expect(normalizeVariantForModel("anthropic/claude-opus-4.1", "max", "low")).toBe("max");
    expect(normalizeVariantForModel("anthropic/claude-opus-4.1", "xhigh", "low")).toBe("max");
  });

  it("accepts injected lane role profiles for runtime resolution", () => {
    const profile = resolveAgentExecutionProfile("ctf-web", {
      roleProfiles: {
        execution: { model: "openai/gpt-5.2", variant: "low" },
        planning: { model: "anthropic/claude-opus-4.1", variant: "max" },
        exploration: { model: "google/gemini-2.5-pro", variant: "" },
      },
    });

    expect(profile.model).toBe("openai/gpt-5.2");
    expect(profile.variant).toBe("low");
  });
});
