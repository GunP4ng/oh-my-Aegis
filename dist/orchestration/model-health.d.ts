import type { SessionState } from "../state/types";
export declare const MODEL_POOL: readonly ["openai/gpt-5.3-codex", "google/antigravity-gemini-3-flash", "google/antigravity-gemini-3-pro"];
export type ModelId = (typeof MODEL_POOL)[number];
export declare const VARIANT_SEP = "--";
export declare function agentModel(agentName: string): ModelId | undefined;
export declare function modelAlternatives(model: ModelId): ModelId[];
export declare function variantAgentName(baseAgent: string, model: ModelId): string;
export declare function baseAgentName(agentName: string): string;
export declare function isModelHealthy(state: SessionState, model: ModelId, cooldownMs?: number): boolean;
export declare function resolveHealthyAgent(baseAgent: string, state: SessionState, cooldownMs?: number): string;
export declare function shouldGenerateVariants(agentName: string): boolean;
export declare function generateVariantEntries(agentName: string, baseProfile: {
    model: string;
    variant: string;
}): Array<{
    name: string;
    model: string;
    variant: string;
}>;
