import { z } from "zod";
import type { OrchestratorConfig } from "../config/schema";
declare const ReviewDecisionUnsignedSchema: z.ZodObject<{
    patch_sha256: z.ZodString;
    author_model: z.ZodString;
    reviewer_model: z.ZodString;
    verdict: z.ZodEnum<{
        pending: "pending";
        approved: "approved";
        rejected: "rejected";
    }>;
    reviewed_at: z.ZodNumber;
}, z.core.$strip>;
export declare const IndependentReviewDecisionSchema: z.ZodObject<{
    patch_sha256: z.ZodString;
    author_model: z.ZodString;
    reviewer_model: z.ZodString;
    verdict: z.ZodEnum<{
        pending: "pending";
        approved: "approved";
        rejected: "rejected";
    }>;
    reviewed_at: z.ZodNumber;
    review_binding_sha256: z.ZodString;
}, z.core.$strip>;
export type IndependentReviewDecision = z.infer<typeof IndependentReviewDecisionSchema>;
export type IndependentReviewDecisionUnsigned = z.infer<typeof ReviewDecisionUnsignedSchema>;
export type IndependentReviewGateResult = {
    ok: true;
    decision: IndependentReviewDecision;
    author_provider_family: string;
    reviewer_provider_family: string;
} | {
    ok: false;
    reason: string;
};
export declare function reviewDecisionBindingSha256(input: IndependentReviewDecisionUnsigned): string;
export declare function bindIndependentReviewDecision(input: IndependentReviewDecisionUnsigned): IndependentReviewDecision;
export declare function evaluateIndependentReviewGate(params: {
    decision: unknown;
    expected_patch_sha256: string;
    config: OrchestratorConfig;
}): IndependentReviewGateResult;
export {};
