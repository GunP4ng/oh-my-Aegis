import type { ProviderFamily, SessionState } from "../state/types";
export declare const MODEL_POOL: readonly ["openai/gpt-5.3-codex", "openai/gpt-5.2", "model_cli/claude-sonnet-4.5", "model_cli/claude-opus-4.1", "model_cli/gemini-2.5-pro"];
export type ModelId = (typeof MODEL_POOL)[number];
export declare const VARIANT_SEP = "--";
export type AgentLane = "execution" | "planning" | "exploration";
export type LaneRoleProfile = {
    model: string;
    variant: string;
};
export type LaneRoleProfiles = {
    execution: LaneRoleProfile;
    planning: LaneRoleProfile;
    exploration: LaneRoleProfile;
};
export declare function defaultProfileForAgentLane(agentName: string, roleProfiles?: Partial<LaneRoleProfiles>): {
    model: string;
    variant: string;
};
export declare function agentModel(agentName: string): string | undefined;
export declare function modelAlternatives(model: string): ModelId[];
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
export declare function providerIdFromModel(model: string): string;
export declare function providerFamilyFromModel(model: string): ProviderFamily;
export declare function supportedVariantsForModel(model: string): string[];
export declare function defaultVariantForModel(model: string): string;
export declare function isVariantSupportedForModel(model: string, variant: string): boolean;
export declare function normalizeVariantForModel(model: string, requestedVariant: string, fallbackVariant?: string): string;
export declare function resolveAgentExecutionProfile(agentName: string, options?: {
    preferredModel?: string;
    preferredVariant?: string;
    roleProfiles?: Partial<LaneRoleProfiles>;
}): {
    baseAgent: string;
    model: string;
    variant: string;
};
