import { describe, expect, it } from "bun:test";
import { normalizeVariantForModel, resolveAgentExecutionProfile } from "../src/orchestration/model-health";

describe("model health variant normalization", () => {
  it("drops variant for Google provider models outside local model pool", () => {
    expect(normalizeVariantForModel("model_cli/gemini-2.5-pro", "high", "medium")).toBe("");
    expect(normalizeVariantForModel("google/gemini-2.0-flash", "low", "high")).toBe("");
  });

  it("resolves Google execution profile without variant even when requested", () => {
    const profile = resolveAgentExecutionProfile("ctf-web", {
      preferredModel: "model_cli/gemini-2.5-pro",
      preferredVariant: "high",
    });

    expect(profile.model).toBe("model_cli/gemini-2.5-pro");
    expect(profile.variant).toBe("");
  });

  it("uses OpenAI model as aegis-plan default", () => {
    const profile = resolveAgentExecutionProfile("aegis-plan");
    expect(profile.model).toBe("openai/gpt-5.2");
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

  it("uses OpenAI profile for ctf-research default", () => {
    const profile = resolveAgentExecutionProfile("ctf-research");
    expect(profile.model).toBe("openai/gpt-5.2");
    expect(profile.variant).toBe("medium");
  });

  it("normalizes model_cli claude variants to low/medium/high", () => {
    expect(normalizeVariantForModel("model_cli/claude-sonnet-4.6", "medium", "low")).toBe("medium");
    expect(normalizeVariantForModel("model_cli/claude-opus-4.6", "max", "low")).toBe("high");
    expect(normalizeVariantForModel("model_cli/claude-haiku-4.5", "xhigh", "low")).toBe("high");
  });

  it("accepts injected lane role profiles for runtime resolution", () => {
    const profile = resolveAgentExecutionProfile("ctf-web", {
      roleProfiles: {
        execution: { model: "openai/gpt-5.2", variant: "low" },
        planning: { model: "model_cli/claude-opus-4.6", variant: "max" },
        exploration: { model: "model_cli/gemini-2.5-pro", variant: "" },
      },
    });

    expect(profile.model).toBe("openai/gpt-5.2");
    expect(profile.variant).toBe("low");
  });
});
