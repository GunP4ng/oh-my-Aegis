import type { SessionState } from "../state/types";
export declare const MODEL_POOL: readonly ["openai/gpt-5.3-codex", "google/antigravity-gemini-3-flash", "google/antigravity-gemini-3-pro", "anthropic/claude-sonnet-4.5", "anthropic/claude-opus-4.1"];
export type ModelId = (typeof MODEL_POOL)[number];
export declare const VARIANT_SEP = "--";
export declare function agentModel(agentName: string): ModelId | undefined;
export declare function modelAlternatives(model: ModelId): ModelId[];
export declare function isKnownModelId(model: string): model is ModelId;
export declare function variantAgentName(baseAgent: string, model: ModelId): string;
export declare function baseAgentName(agentName: string): string;
export declare function isModelHealthy(state: SessionState, model: string, cooldownMs?: number): boolean;
export declare function resolveHealthyModel(baseAgent: string, state: SessionState, cooldownMs?: number): string | undefined;
export declare function shouldGenerateVariants(agentName: string): boolean;
export declare function generateVariantEntries(agentName: string, baseProfile: {
    model: string;
    variant?: string;
}): Array<{
    name: string;
    model: string;
    variant: string;
}>;
export declare function supportedVariantsForModel(model: string): string[];
export declare function defaultVariantForModel(model: string): string;
export declare function isVariantSupportedForModel(model: string, variant: string): boolean;
export declare function normalizeVariantForModel(model: string, requestedVariant: string, fallbackVariant?: string): string;
export declare function resolveAgentExecutionProfile(agentName: string, options?: {
    preferredModel?: string;
    preferredVariant?: string;
}): {
    baseAgent: string;
    model: string;
    variant: string;
};
