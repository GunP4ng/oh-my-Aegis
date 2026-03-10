export type PatchDigestResult = { ok: true; digest: string } | { ok: false; reason: string };

export const SHA256_HEX = /^[a-f0-9]{64}$/;

export const hasPatchArtifactRefChain = (refs: string[]): boolean => {
  const hasManifest = refs.some((ref) => ref.startsWith("manifest_ref=") && /\.Aegis\/runs\/.+\/run-manifest\.json$/i.test(ref));
  const hasDiff = refs.some((ref) => ref.startsWith("patch_diff_ref=") && /\.Aegis\/runs\/.+\/patches\/.+\.diff$/i.test(ref));
  const hasSandbox = refs.some((ref) => ref.startsWith("sandbox_cwd=") && /\/\.Aegis\/runs\/.+\/sandbox$/i.test(ref.replace(/\\/g, "/")));
  const hasRunId = refs.some((ref) => ref.startsWith("run_id=") && ref.length > "run_id=".length);
  return hasManifest && hasDiff && hasSandbox && hasRunId;
};

export const patchDiffRefFromRefs = (refs: string[]): string | null => {
  for (let i = refs.length - 1; i >= 0; i -= 1) {
    const ref = refs[i];
    if (!ref.startsWith("patch_diff_ref=")) {
      continue;
    }
    const value = ref.slice("patch_diff_ref=".length).trim();
    if (value.length > 0) {
      return value;
    }
  }
  return null;
};

export const digestFromPatchDiffRef = (
  patchDiffRef: string,
  deps: {
    resolvePatchDiffRef: (patchDiffRef: string) => { ok: true; absPath: string } | { ok: false };
    readPatchDiffBytes: (absPath: string) => Uint8Array;
    sha256FromBytes: (bytes: Uint8Array) => string;
  },
): PatchDigestResult => {
  const resolvedPath = deps.resolvePatchDiffRef(patchDiffRef);
  if (!resolvedPath.ok) {
    return { ok: false, reason: "governance_patch_diff_ref_outside_project" };
  }
  try {
    const bytes = deps.readPatchDiffBytes(resolvedPath.absPath);
    if (bytes.length === 0) {
      return { ok: false, reason: "governance_patch_diff_ref_empty" };
    }
    return { ok: true, digest: deps.sha256FromBytes(bytes) };
  } catch {
    return { ok: false, reason: "governance_patch_diff_ref_unreadable" };
  }
};

type ApplyGovernanceState = {
  governance: {
    patch: {
      digest: string;
      proposalRefs: string[];
      authorProviderFamily: string;
      reviewerProviderFamily: string;
    };
    review: {
      verdict: string;
      digest: string;
    };
  };
};

type ApplyGovernanceConfig = {
  patch_boundary: {
    enabled: boolean;
    fail_closed: boolean;
  };
  review_gate: {
    enabled: boolean;
    fail_closed: boolean;
    require_independent_reviewer: boolean;
    enforce_provider_family_separation: boolean;
  };
};

export const evaluateApplyGovernancePrerequisites = <
  TState extends ApplyGovernanceState,
  TConfig extends ApplyGovernanceConfig,
>(
  deps: {
    state: TState;
    config: TConfig;
    digestFromPatchDiffRef: (patchDiffRef: string) => PatchDigestResult;
    evaluateCouncilPolicy: (state: TState, config: TConfig) => { required: boolean; blocked: boolean };
  },
): { ok: true } | { ok: false; reason: string } => {
  const { state, config } = deps;

  if (config.patch_boundary.enabled && config.patch_boundary.fail_closed) {
    const digest = state.governance.patch.digest.trim().toLowerCase();
    if (!digest || !SHA256_HEX.test(digest)) {
      return { ok: false, reason: "governance_patch_missing_or_invalid_digest" };
    }
    if (!hasPatchArtifactRefChain(state.governance.patch.proposalRefs)) {
      return { ok: false, reason: "governance_patch_artifact_chain_incomplete" };
    }
    const patchDiffRef = patchDiffRefFromRefs(state.governance.patch.proposalRefs);
    if (!patchDiffRef) {
      return { ok: false, reason: "governance_patch_artifact_chain_incomplete" };
    }
    const artifactDigest = deps.digestFromPatchDiffRef(patchDiffRef);
    if (!artifactDigest.ok) {
      return { ok: false, reason: artifactDigest.reason };
    }
    if (artifactDigest.digest !== digest) {
      return { ok: false, reason: "governance_patch_digest_artifact_mismatch" };
    }
  }

  if (config.review_gate.enabled && config.review_gate.fail_closed) {
    const verdict = state.governance.review.verdict;
    if (verdict !== "approved") {
      return { ok: false, reason: `governance_review_not_approved:${verdict}` };
    }
    if (!state.governance.review.digest || state.governance.review.digest !== state.governance.patch.digest) {
      return { ok: false, reason: "governance_review_digest_mismatch" };
    }
    if (config.review_gate.require_independent_reviewer || config.review_gate.enforce_provider_family_separation) {
      const authorFamily = state.governance.patch.authorProviderFamily;
      const reviewerFamily = state.governance.patch.reviewerProviderFamily;
      if (authorFamily === "unknown" || reviewerFamily === "unknown") {
        return { ok: false, reason: "governance_review_provider_family_unknown" };
      }
      if (authorFamily === reviewerFamily) {
        return { ok: false, reason: `governance_review_provider_family_not_independent:${authorFamily}` };
      }
    }
  }

  const council = deps.evaluateCouncilPolicy(state, config);
  if (council.required && council.blocked) {
    return { ok: false, reason: "governance_council_required_missing_artifact" };
  }

  return { ok: true };
};
