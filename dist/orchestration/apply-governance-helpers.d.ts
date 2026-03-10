export type PatchDigestResult = {
    ok: true;
    digest: string;
} | {
    ok: false;
    reason: string;
};
export declare const SHA256_HEX: RegExp;
export declare const hasPatchArtifactRefChain: (refs: string[]) => boolean;
export declare const patchDiffRefFromRefs: (refs: string[]) => string | null;
export declare const digestFromPatchDiffRef: (patchDiffRef: string, deps: {
    resolvePatchDiffRef: (patchDiffRef: string) => {
        ok: true;
        absPath: string;
    } | {
        ok: false;
    };
    readPatchDiffBytes: (absPath: string) => Uint8Array;
    sha256FromBytes: (bytes: Uint8Array) => string;
}) => PatchDigestResult;
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
export declare const evaluateApplyGovernancePrerequisites: <TState extends ApplyGovernanceState, TConfig extends ApplyGovernanceConfig>(deps: {
    state: TState;
    config: TConfig;
    digestFromPatchDiffRef: (patchDiffRef: string) => PatchDigestResult;
    evaluateCouncilPolicy: (state: TState, config: TConfig) => {
        required: boolean;
        blocked: boolean;
    };
}) => {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export {};
