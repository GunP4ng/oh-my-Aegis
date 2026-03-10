import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
export interface GovernancePatchProposalUpdate {
    proposalRefs: string[];
    digest: string;
    authorModel: string;
}
export interface GovernanceReviewUpdate {
    verdict: "pending" | "approved" | "rejected";
    digest: string;
    reviewedAt: number;
    authorProviderFamily: string;
    reviewerProviderFamily: string;
}
export interface GovernanceCouncilUpdate {
    decisionArtifactRef: string;
    decidedAt: number;
}
export interface GovernanceArtifactStageResult {
    metricSignals: string[];
    patchProposalUpdate: GovernancePatchProposalUpdate | null;
    reviewUpdate: GovernanceReviewUpdate | null;
    councilUpdate: GovernanceCouncilUpdate | null;
}
export interface GovernanceArtifactStageInput {
    tool: string;
    sessionID: string;
    parsedToolOutput: Record<string, unknown> | null;
    state: SessionState;
    digestFromPatchDiffRef: (patchDiffRef: string) => {
        ok: true;
        digest: string;
    } | {
        ok: false;
        reason: string;
    };
    evaluateIndependentReviewGate: (input: {
        decision: unknown;
        expected_patch_sha256: string;
        config: OrchestratorConfig;
    }) => {
        ok: true;
        decision: {
            verdict: "pending" | "approved" | "rejected";
            patch_sha256: string;
            reviewed_at: number;
        };
        author_provider_family: string;
        reviewer_provider_family: string;
    } | {
        ok: false;
    };
    providerFamilyFromModel: (model: string) => SessionState["governance"]["patch"]["authorProviderFamily"];
    config: OrchestratorConfig;
}
export declare function captureGovernanceArtifactsStage(input: GovernanceArtifactStageInput): GovernanceArtifactStageResult;
export interface PlanSnapshotStageResult {
    shouldWrite: boolean;
    content: string;
}
export declare function buildPlanSnapshotStage(input: {
    tool: string;
    lastTaskCategory: string;
    originalOutput: unknown;
    sessionID: string;
    nowIso: string;
}): PlanSnapshotStageResult;
export declare function contradictionArtifactStage(input: {
    tool: string;
    state: SessionState;
    lastRouteBase: string;
    artifactHints: string[];
}): string[];
export interface EarlyDecoyStageResult {
    metricSignals: string[];
    setDecoySuspect: {
        reason: string;
    } | null;
    setEarlyCandidate: {
        candidate: string;
    } | null;
    toastMessage: string | null;
}
export declare function earlyFlagDecoyStage(input: {
    flagDetectorEnabled: boolean;
    raw: string;
    tool: string;
    state: SessionState;
}): EarlyDecoyStageResult;
export interface VerifyOutcome {
    kind: "verify_fail" | "verify_success" | "verify_blocked";
    contradictionDetected: boolean;
    contradictionSLAUpdate: boolean;
    verifierEvidence: string;
    acceptanceOk: boolean;
    normalizedSummary: string;
    failureReason: "static_dynamic_contradiction" | "verification_mismatch";
    taggedSummary: string;
    domainGatePassed: boolean;
    envEvidenceOk: boolean;
    toast: {
        key: string;
        title: string;
        message: string;
        variant: "error" | "success" | "warning";
    };
    metricSignals: string[];
    metricExtras: Record<string, unknown>;
}
export declare function classifyVerificationStage(input: {
    raw: string;
    state: SessionState;
}): VerifyOutcome | null;
export interface OracleProgressStageResult {
    changed: boolean;
    nextState: Partial<SessionState>;
    metricSignals: string[];
    metricExtras: Record<string, unknown>;
    ledgerSummary: string;
    confidence: number;
}
export declare function evaluateOracleProgressStage(input: {
    parsedOracleProgress: {
        passCount: number;
        failIndex: number;
        totalTests: number;
    };
    state: SessionState;
    now: number;
}): OracleProgressStageResult;
export interface ModelHealthStageResult {
    shouldRecordOutcome: boolean;
    outcome: "success" | "retryable_failure" | "hard_failure";
    tokenOrQuotaFailure: boolean;
    useModelFailover: boolean;
    modelToMarkUnhealthy: string;
    reason: string;
}
export declare function classifyTaskOutcomeAndModelHealthStage(input: {
    tool: string;
    raw: string;
    state: SessionState;
    classifiedFailure: "none" | "verification_mismatch" | "tooling_timeout" | "context_overflow" | "hypothesis_stall" | "unsat_claim" | "static_dynamic_contradiction" | "exploit_chain" | "environment";
    config: OrchestratorConfig;
    agentModel: (agentName: string) => string | undefined;
}): ModelHealthStageResult;
export interface FailoverAutoloopStageResult {
    armFailover: boolean;
    clearFailover: boolean;
    disableAutoloop: boolean;
    metricSignals: string[];
    failoverToastMessage: string;
    failoverNoteMessage: string;
    autoloopNoteMessage: string;
}
export declare function shapeTaskFailoverAutoloopStage(input: {
    state: SessionState;
    isRetryableFailure: boolean;
    useModelFailover: boolean;
    maxFailoverRetries: number;
    classifiedFailure: "none" | "verification_mismatch" | "tooling_timeout" | "context_overflow" | "hypothesis_stall" | "unsat_claim" | "static_dynamic_contradiction" | "exploit_chain" | "environment";
}): FailoverAutoloopStageResult;
export interface EvidenceLedgerIntent {
    event: string;
    evidenceType: "behavioral_runtime" | "dynamic_memory" | "acceptance_oracle" | "string_pattern" | "static_reverse";
    confidence: number;
    summary: string;
    orchestrationOnly?: boolean;
}
export declare function buildEvidenceLedgerIntentsStage(input: {
    verifyOutcome: VerifyOutcome | null;
    verifyFailDecoyReason: string;
    oracleProgressSummary: string;
    oracleProgressConfidence: number;
}): EvidenceLedgerIntent[];
export declare function classifyVerifyFailDecoyStage(input: {
    raw: string;
    state: SessionState;
}): {
    decoyReason: string;
} | null;
export declare function classifyFlagDetectorStage(input: {
    enabled: boolean;
    outputText: string;
    tool: string;
}): {
    flags: string[];
    alert: string;
} | null;
export declare function routeVerifierStage(input: {
    tool: string;
    lastTaskRoute: string;
    isVerificationSourceRelevant: boolean;
    raw: string;
    parseOracleProgressFromText: (text: string) => {
        passCount: number;
        failIndex: number;
        totalTests: number;
    } | null;
}): {
    routeVerifier: boolean;
    verificationRelevant: boolean;
    parsedOracleProgress: {
        passCount: number;
        failIndex: number;
        totalTests: number;
    } | null;
};
export declare function classifyFailureForMetricsStage(input: {
    classifiedFailure: "none" | "verification_mismatch" | "tooling_timeout" | "context_overflow" | "hypothesis_stall" | "unsat_claim" | "static_dynamic_contradiction" | "exploit_chain" | "environment";
    raw: string;
    failedRoute: string;
}): {
    shouldSetFailureDetails: boolean;
    setFailureReason: "hypothesis_stall" | "exploit_chain" | "environment" | "unsat_claim" | "static_dynamic_contradiction" | "none";
    summary: string;
    failedRoute: string;
    metricSignal: string;
    event: "same_payload_repeat" | "no_new_evidence" | "none";
};
