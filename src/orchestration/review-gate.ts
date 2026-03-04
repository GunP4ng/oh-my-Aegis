import { createHash } from "node:crypto";
import { z } from "zod";
import type { OrchestratorConfig } from "../config/schema";
import { providerFamilyFromModel } from "./model-health";

const SHA256_HEX = /^[a-f0-9]{64}$/;

const ReviewVerdictSchema = z.enum(["pending", "approved", "rejected"]);

const ReviewDecisionUnsignedSchema = z.object({
  patch_sha256: z.string().trim().regex(SHA256_HEX),
  author_model: z.string().trim().min(1),
  reviewer_model: z.string().trim().min(1),
  verdict: ReviewVerdictSchema,
  reviewed_at: z.number().int().nonnegative(),
});

export const IndependentReviewDecisionSchema = ReviewDecisionUnsignedSchema.extend({
  review_binding_sha256: z.string().trim().regex(SHA256_HEX),
});

export type IndependentReviewDecision = z.infer<typeof IndependentReviewDecisionSchema>;
export type IndependentReviewDecisionUnsigned = z.infer<typeof ReviewDecisionUnsignedSchema>;

export type IndependentReviewGateResult =
  | {
      ok: true;
      decision: IndependentReviewDecision;
      author_provider_family: string;
      reviewer_provider_family: string;
    }
  | {
      ok: false;
      reason: string;
    };

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function canonicalBindingPayload(input: IndependentReviewDecisionUnsigned): string {
  return [
    "independent_review_gate_v1",
    input.patch_sha256,
    input.author_model,
    input.reviewer_model,
    input.verdict,
    String(input.reviewed_at),
  ].join("|");
}

export function reviewDecisionBindingSha256(input: IndependentReviewDecisionUnsigned): string {
  return sha256Hex(canonicalBindingPayload(input));
}

export function bindIndependentReviewDecision(
  input: IndependentReviewDecisionUnsigned
): IndependentReviewDecision {
  const parsed = ReviewDecisionUnsignedSchema.parse(input);
  return {
    ...parsed,
    review_binding_sha256: reviewDecisionBindingSha256(parsed),
  };
}

export function evaluateIndependentReviewGate(params: {
  decision: unknown;
  expected_patch_sha256: string;
  config: OrchestratorConfig;
}): IndependentReviewGateResult {
  const gate = params.config.review_gate;
  if (!gate.enabled) {
    return { ok: false, reason: "review_gate_disabled" };
  }

  const expectedPatchSha = params.expected_patch_sha256.trim().toLowerCase();
  if (!SHA256_HEX.test(expectedPatchSha)) {
    return { ok: false, reason: "review_expected_patch_sha256_invalid" };
  }

  const parsedDecision = IndependentReviewDecisionSchema.safeParse(params.decision);
  if (!parsedDecision.success) {
    return { ok: false, reason: "review_decision_schema_invalid" };
  }

  const decision = {
    ...parsedDecision.data,
    patch_sha256: parsedDecision.data.patch_sha256.toLowerCase(),
    review_binding_sha256: parsedDecision.data.review_binding_sha256.toLowerCase(),
  };

  if (gate.require_patch_digest_match && decision.patch_sha256 !== expectedPatchSha) {
    return { ok: false, reason: "review_patch_sha256_mismatch" };
  }

  const expectedBindingSha = reviewDecisionBindingSha256(decision);
  if (decision.review_binding_sha256 !== expectedBindingSha) {
    return { ok: false, reason: "review_binding_sha256_mismatch" };
  }

  if (gate.require_independent_reviewer && decision.author_model === decision.reviewer_model) {
    return { ok: false, reason: "review_independent_reviewer_required" };
  }

  const authorProviderFamily = providerFamilyFromModel(decision.author_model);
  const reviewerProviderFamily = providerFamilyFromModel(decision.reviewer_model);

  if (gate.enforce_provider_family_separation) {
    if (authorProviderFamily === "unknown" || reviewerProviderFamily === "unknown") {
      return { ok: false, reason: "review_provider_family_unknown" };
    }
    if (authorProviderFamily === reviewerProviderFamily) {
      return { ok: false, reason: `review_provider_family_separation_required:${authorProviderFamily}` };
    }
  }

  if (decision.verdict === "pending") {
    return { ok: false, reason: "review_verdict_pending" };
  }
  if (decision.verdict === "rejected") {
    return { ok: false, reason: "review_verdict_rejected" };
  }

  return {
    ok: true,
    decision,
    author_provider_family: authorProviderFamily,
    reviewer_provider_family: reviewerProviderFamily,
  };
}
