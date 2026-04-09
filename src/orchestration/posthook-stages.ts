import type { OrchestratorConfig } from "../config/schema";
import { isRecord } from "../utils/is-record";
import { appendUniqueRef } from "../helpers/append-unique-ref";
import { buildFlagAlert, checkForDecoy, containsFlag, scanForFlags } from "./flag-detector";
import { computeOracleProgress } from "./evidence-ledger";
import {
  extractVerifierEvidence,
  hasAcceptanceEvidence,
  hasExitCodeZeroEvidence,
  hasRuntimeEvidence,
  hasVerifierEvidence,
  hasVerifyOracleSuccess,
  isVerifyFailure,
  isVerifySuccess,
  isRetryableTaskFailure,
  isTokenOrQuotaFailure,
} from "../risk/sanitize";
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
  digestFromPatchDiffRef: (patchDiffRef: string) => { ok: true; digest: string } | { ok: false; reason: string };
  evaluateIndependentReviewGate: (input: {
    decision: unknown;
    expected_patch_sha256: string;
    config: OrchestratorConfig;
  }) =>
    | {
      ok: true;
      decision: { verdict: "pending" | "approved" | "rejected"; patch_sha256: string; reviewed_at: number };
      author_provider_family: string;
      reviewer_provider_family: string;
    }
    | { ok: false };
  providerFamilyFromModel: (model: string) => SessionState["governance"]["patch"]["authorProviderFamily"];
  config: OrchestratorConfig;
}

function toFiniteInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

export function captureGovernanceArtifactsStage(input: GovernanceArtifactStageInput): GovernanceArtifactStageResult {
  const { parsedToolOutput } = input;
  const metricSignals: string[] = [];
  let patchProposalUpdate: GovernancePatchProposalUpdate | null = null;
  let reviewUpdate: GovernanceReviewUpdate | null = null;
  let councilUpdate: GovernanceCouncilUpdate | null = null;

  if (parsedToolOutput && (input.tool === "ctf_gemini_cli" || input.tool === "ctf_claude_code")) {
    const envelope = isRecord(parsedToolOutput.proposal_envelope)
      ? (parsedToolOutput.proposal_envelope as Record<string, unknown>)
      : null;
    const runID = envelope && typeof envelope.run_id === "string" ? envelope.run_id.trim() : "";
    const manifestRef = envelope && typeof envelope.manifest_ref === "string" ? envelope.manifest_ref.trim() : "";
    const patchDiffRef = envelope && typeof envelope.patch_diff_ref === "string" ? envelope.patch_diff_ref.trim() : "";
    const sandboxCwd = envelope && typeof envelope.sandbox_cwd === "string" ? envelope.sandbox_cwd.trim() : "";
    const hasProposalChain = Boolean(runID && manifestRef && patchDiffRef && sandboxCwd);

    if (hasProposalChain) {
      const existingRefs = [...input.state.governance.patch.proposalRefs];
      let refs = appendUniqueRef(existingRefs, `run_id=${runID}`);
      refs = appendUniqueRef(refs, `manifest_ref=${manifestRef}`);
      refs = appendUniqueRef(refs, `patch_diff_ref=${patchDiffRef}`);
      refs = appendUniqueRef(refs, `sandbox_cwd=${sandboxCwd.replace(/\\/g, "/")}`);

      if (isRecord(parsedToolOutput.proposal_metrics)) {
        const metrics = parsedToolOutput.proposal_metrics as Record<string, unknown>;
        const files = toFiniteInt(metrics.file_count) ?? 0;
        const loc = toFiniteInt(metrics.total_loc) ?? 0;
        const risk = toFiniteInt(metrics.risk_score) ?? 0;
        const critical = toFiniteInt(metrics.critical_paths_touched) ?? 0;
        if (files > 0) refs = appendUniqueRef(refs, `files=${files}`);
        if (loc > 0) refs = appendUniqueRef(refs, `loc=${loc}`);
        if (risk > 0) refs = appendUniqueRef(refs, `risk_score=${risk}`);
        if (critical > 0) refs = appendUniqueRef(refs, `critical_paths_touched=${critical}`);
      }

      const authorModel =
        typeof parsedToolOutput.model === "string" && parsedToolOutput.model.trim().length > 0
          ? parsedToolOutput.model.trim()
          : input.tool === "ctf_gemini_cli"
            ? "google/gemini-cli"
            : "anthropic/claude-code";
      const digestFromArtifact = input.digestFromPatchDiffRef(patchDiffRef);
      if (!digestFromArtifact.ok) {
        metricSignals.push(`governance_patch_proposal_rejected:${digestFromArtifact.reason}`);
      } else {
        patchProposalUpdate = {
          proposalRefs: refs,
          digest: digestFromArtifact.digest,
          authorModel,
        };
        metricSignals.push("governance_patch_proposal_recorded");
      }
    }
  }

  if (parsedToolOutput) {
    const reviewDecisionCandidate =
      isRecord(parsedToolOutput.review_decision)
        ? parsedToolOutput.review_decision
        : isRecord(parsedToolOutput.decision)
          ? parsedToolOutput.decision
          : parsedToolOutput;

    const maybeReview = input.evaluateIndependentReviewGate({
      decision: reviewDecisionCandidate,
      expected_patch_sha256: input.state.governance.patch.digest,
      config: input.config,
    });

    if (maybeReview.ok) {
      reviewUpdate = {
        verdict: maybeReview.decision.verdict,
        digest: maybeReview.decision.patch_sha256,
        reviewedAt: maybeReview.decision.reviewed_at,
        authorProviderFamily: maybeReview.author_provider_family,
        reviewerProviderFamily: maybeReview.reviewer_provider_family,
      };
      metricSignals.push("governance_review_recorded");
    }

    const councilArtifactRefRaw =
      typeof parsedToolOutput.council_decision_artifact_ref === "string"
        ? parsedToolOutput.council_decision_artifact_ref
        : typeof parsedToolOutput.decisionArtifactRef === "string"
          ? parsedToolOutput.decisionArtifactRef
          : "";
    const councilArtifactRef = councilArtifactRefRaw.trim();
    const decidedAtRaw =
      typeof parsedToolOutput.council_decided_at === "number"
        ? parsedToolOutput.council_decided_at
        : typeof parsedToolOutput.decidedAt === "number"
          ? parsedToolOutput.decidedAt
          : Date.now();
    const decidedAt = Number.isFinite(decidedAtRaw) ? Math.max(0, Math.floor(decidedAtRaw)) : Date.now();
    if (councilArtifactRef.length > 0) {
      councilUpdate = {
        decisionArtifactRef: councilArtifactRef,
        decidedAt,
      };
      metricSignals.push("governance_council_recorded");
    }
  }

  return {
    metricSignals,
    patchProposalUpdate,
    reviewUpdate,
    councilUpdate,
  };
}

export interface PlanSnapshotStageResult {
  shouldWrite: boolean;
  content: string;
}

export function buildPlanSnapshotStage(input: {
  tool: string;
  lastTaskCategory: string;
  originalOutput: unknown;
  sessionID: string;
  nowIso: string;
}): PlanSnapshotStageResult {
  const isPlanTask = input.tool === "task" && input.lastTaskCategory === "aegis-plan";
  const text = typeof input.originalOutput === "string" ? input.originalOutput.trim() : "";
  if (!isPlanTask || text.length === 0) {
    return { shouldWrite: false, content: "" };
  }
  const content = [
    "# PLAN",
    `updated_at: ${input.nowIso}`,
    `session_id: ${input.sessionID}`,
    "",
    text,
    "",
  ].join("\n");
  return { shouldWrite: true, content };
}

export function contradictionArtifactStage(input: {
  tool: string;
  state: SessionState;
  lastRouteBase: string;
  artifactHints: string[];
}): string[] {
  const contradictionArtifactRoutes = new Set([
    "ctf-web",
    "ctf-web3",
    "ctf-pwn",
    "ctf-rev",
    "ctf-crypto",
    "ctf-forensics",
    "ctf-explore",
    "ctf-research",
    "bounty-triage",
    "bounty-research",
  ]);
  const filteredArtifactHints = input.artifactHints.filter((hint) => {
    if (hint.includes("/.Aegis/") || hint.startsWith(".Aegis/") || hint.startsWith("./.Aegis/")) {
      return true;
    }
    return /^\/tmp\/[A-Za-z0-9._-]+\.(?:out|bin|elf|dump|log|json)$/.test(hint);
  });

  if (
    (input.tool === "task" || input.tool === "bash" || input.tool === "aegis_bash") &&
    input.state.contradictionArtifactLockActive &&
    !input.state.contradictionPatchDumpDone &&
    contradictionArtifactRoutes.has(input.lastRouteBase) &&
    filteredArtifactHints.length > 0
  ) {
    return filteredArtifactHints;
  }
  return [];
}

export interface EarlyDecoyStageResult {
  metricSignals: string[];
  setDecoySuspect: { reason: string } | null;
  setEarlyCandidate: { candidate: string } | null;
  toastMessage: string | null;
}

export function earlyFlagDecoyStage(input: {
  flagDetectorEnabled: boolean;
  raw: string;
  tool: string;
  state: SessionState;
}): EarlyDecoyStageResult {
  if (!input.flagDetectorEnabled || input.raw.length >= 200_000) {
    return {
      metricSignals: [],
      setDecoySuspect: null,
      setEarlyCandidate: null,
      toastMessage: null,
    };
  }

  const earlyCandidates = scanForFlags(input.raw, `tool.${input.tool}`);
  if (earlyCandidates.length === 0) {
    return {
      metricSignals: [],
      setDecoySuspect: null,
      setEarlyCandidate: null,
      toastMessage: null,
    };
  }

  if (!input.state.decoySuspect) {
    const earlyDecoyResult = checkForDecoy(earlyCandidates, false);
    if (earlyDecoyResult.isDecoySuspect) {
      return {
        metricSignals: ["early_decoy_suspect"],
        setDecoySuspect: { reason: earlyDecoyResult.reason },
        setEarlyCandidate: null,
        toastMessage: `Early decoy detection: ${earlyDecoyResult.reason}`,
      };
    }
  }

  if (!input.state.candidatePendingVerification && !input.state.decoySuspect) {
    return {
      metricSignals: ["early_candidate_found"],
      setDecoySuspect: null,
      setEarlyCandidate: { candidate: earlyCandidates[0]?.flag ?? "" },
      toastMessage: null,
    };
  }

  return {
    metricSignals: [],
    setDecoySuspect: null,
    setEarlyCandidate: null,
    toastMessage: null,
  };
}

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
  toast: { key: string; title: string; message: string; variant: "error" | "success" | "warning" };
  metricSignals: string[];
  metricExtras: Record<string, unknown>;
}

export function classifyVerificationStage(input: {
  raw: string;
  state: SessionState;
}): VerifyOutcome | null {
  const state = input.state;
  const raw = input.raw;
  const verifierEvidence = extractVerifierEvidence(raw, state.latestCandidate);
  const normalizedSummary = raw.replace(/\s+/g, " ").trim().slice(0, 240);

  const isCTF = state.mode === "CTF";
  const tt = state.targetType;
  const oracleOk = hasVerifyOracleSuccess(raw);
  const exitCodeOk = hasExitCodeZeroEvidence(raw);
  const runtimeEvidenceOk = hasRuntimeEvidence(raw);
  const parityEvidenceOk = state.envParityChecked && state.envParityAllMatch;
  const envEvidenceOk = parityEvidenceOk || runtimeEvidenceOk;

  const httpEvidenceOk = /\b(?:HTTP\/[12]|status[:\s]*[2345]\d\d|response\s*body)/i.test(raw);
  const txEvidenceOk = /\b(?:0x[0-9a-f]{64}|transaction\s*hash|tx\s*hash|simulation\s*pass)/i.test(raw);
  const testVectorOk = /\b(?:test\s*vector|known\s*plaintext|decrypt(?:ed|ion)\s*match)/i.test(raw);
  const artifactHashOk = /\b(?:sha256|md5|hash[:\s]+[0-9a-f]{32,64}|artifact\s*(?:hash|digest))/i.test(raw);

  let domainGatePassed = true;
  if (isCTF) {
    if (tt === "PWN" || tt === "REV") {
      domainGatePassed = oracleOk && exitCodeOk && envEvidenceOk;
    } else if (tt === "WEB_API") {
      domainGatePassed = oracleOk && httpEvidenceOk;
    } else if (tt === "WEB3") {
      domainGatePassed = oracleOk && txEvidenceOk;
    } else if (tt === "CRYPTO") {
      domainGatePassed = oracleOk && testVectorOk;
    } else if (tt === "FORENSICS") {
      domainGatePassed = oracleOk && artifactHashOk;
    } else {
      domainGatePassed = oracleOk;
    }
  }

  if (isVerifyFailure(raw)) {
    const contradictionDetected = state.mode === "CTF" && Boolean(verifierEvidence);
    return {
      kind: "verify_fail",
      contradictionDetected,
      contradictionSLAUpdate: contradictionDetected,
      verifierEvidence: "",
      acceptanceOk: false,
      normalizedSummary,
      failureReason: contradictionDetected ? "static_dynamic_contradiction" : "verification_mismatch",
      taggedSummary: normalizedSummary,
      domainGatePassed,
      envEvidenceOk,
      toast: {
        key: "verify_fail",
        title: "oh-my-Aegis: verify fail",
        message: "Verifier reported failure.",
        variant: "error",
      },
      metricSignals: contradictionDetected
        ? ["verify_fail", "static_dynamic_contradiction"]
        : ["verify_fail"],
      metricExtras: {},
    };
  }

  if (!isVerifySuccess(raw)) {
    return null;
  }

  const strictGatePassed = domainGatePassed;
  if (hasVerifierEvidence(raw, state.latestCandidate) && verifierEvidence && strictGatePassed) {
    const acceptanceOk = hasAcceptanceEvidence(raw);
    return {
      kind: "verify_success",
      contradictionDetected: false,
      contradictionSLAUpdate: false,
      verifierEvidence,
      acceptanceOk,
      normalizedSummary,
      failureReason: "verification_mismatch",
      taggedSummary: normalizedSummary,
      domainGatePassed,
      envEvidenceOk,
      toast: acceptanceOk
        ? {
          key: "verify_success",
          title: "oh-my-Aegis: verified",
          message: "Verifier success and acceptance evidence confirmed.",
          variant: "success",
        }
        : {
          key: "submit_pending",
          title: "oh-my-Aegis: submit gate pending",
          message: "Verification passed, but acceptance oracle evidence is still required before final submit.",
          variant: "warning",
        },
      metricSignals: acceptanceOk ? ["verify_success", "submit_accepted"] : ["verify_success", "submit_pending"],
      metricExtras: {
        verifiedEvidence: verifierEvidence,
      },
    };
  }

  const isContradiction = isCTF && !domainGatePassed && hasVerifierEvidence(raw, state.latestCandidate);
  const failureReason = isContradiction ? "static_dynamic_contradiction" : "verification_mismatch";
  const taggedSummary = `verify_blocked:${failureReason} ${normalizedSummary}`;
  return {
    kind: "verify_blocked",
    contradictionDetected: isContradiction,
    contradictionSLAUpdate: isContradiction,
    verifierEvidence: "",
    acceptanceOk: false,
    normalizedSummary,
    failureReason,
    taggedSummary,
    domainGatePassed,
    envEvidenceOk,
    toast: {
      key: "verify_fail_no_evidence",
      title: "oh-my-Aegis: verify blocked",
      message: !domainGatePassed
        ? `Success marker blocked by ${tt} domain verify gate (domain-specific evidence required).`
        : "Success marker detected but verifier evidence was missing.",
      variant: "warning",
    },
    metricSignals: isContradiction
      ? ["verify_blocked", "static_dynamic_contradiction", ...(input.state.mode === "CTF" && !envEvidenceOk ? ["readonly_inconclusive"] : [])]
      : ["verify_blocked"],
    metricExtras: {
      verifyBlockedReason: failureReason,
    },
  };
}

export interface OracleProgressStageResult {
  changed: boolean;
  nextState: Partial<SessionState>;
  metricSignals: string[];
  metricExtras: Record<string, unknown>;
  ledgerSummary: string;
  confidence: number;
}

export function evaluateOracleProgressStage(input: {
  parsedOracleProgress: { passCount: number; failIndex: number; totalTests: number };
  state: SessionState;
  now: number;
}): OracleProgressStageResult {
  const prev = {
    passCount: input.state.oraclePassCount,
    failIndex: input.state.oracleFailIndex,
    totalTests: input.state.oracleTotalTests,
  };
  const changed =
    input.parsedOracleProgress.passCount !== prev.passCount ||
    input.parsedOracleProgress.failIndex !== prev.failIndex ||
    input.parsedOracleProgress.totalTests !== prev.totalTests;

  if (!changed) {
    return {
      changed: false,
      nextState: {},
      metricSignals: [],
      metricExtras: {},
      ledgerSummary: "",
      confidence: 0,
    };
  }

  const progress = computeOracleProgress(input.parsedOracleProgress, prev);
  const nextState: Partial<SessionState> = {
    oraclePassCount: input.parsedOracleProgress.passCount,
    oracleFailIndex: input.parsedOracleProgress.failIndex,
    oracleTotalTests: input.parsedOracleProgress.totalTests,
    oracleProgressUpdatedAt: input.now,
  };
  if (progress.improved) {
    nextState.oracleProgressImprovedAt = input.now;
    nextState.noNewEvidenceLoops = Math.max(0, input.state.noNewEvidenceLoops - 1);
    nextState.samePayloadLoops = Math.max(0, input.state.samePayloadLoops - 1);
  }

  return {
    changed: true,
    nextState,
    metricSignals: progress.improved ? ["oracle_progress", "oracle_progress_improved"] : ["oracle_progress"],
    metricExtras: {
      oracleProgress: {
        passCount: progress.passCount,
        failIndex: progress.failIndex,
        totalTests: progress.totalTests,
        improved: progress.improved,
        passRate: Number(progress.passRate.toFixed(4)),
      },
    },
    ledgerSummary: `Oracle progress parsed: pass=${progress.passCount}/${progress.totalTests} fail_index=${progress.failIndex} improved=${progress.improved}`,
    confidence: progress.improved ? 0.8 : 0.6,
  };
}

export interface ModelHealthStageResult {
  shouldRecordOutcome: boolean;
  outcome: "success" | "retryable_failure" | "hard_failure";
  tokenOrQuotaFailure: boolean;
  useModelFailover: boolean;
  modelToMarkUnhealthy: string;
  reason: string;
}

export function classifyTaskOutcomeAndModelHealthStage(input: {
  tool: string;
  raw: string;
  state: SessionState;
  classifiedFailure:
    | "none"
    | "verification_mismatch"
    | "tooling_timeout"
    | "context_overflow"
    | "input_validation_non_retryable"
    | "hypothesis_stall"
    | "unsat_claim"
    | "static_dynamic_contradiction"
    | "exploit_chain"
    | "environment";
  config: OrchestratorConfig;
  agentModel: (agentName: string) => string | undefined;
}): ModelHealthStageResult {
  if (input.tool !== "task") {
    return {
      shouldRecordOutcome: false,
      outcome: "success",
      tokenOrQuotaFailure: false,
      useModelFailover: false,
      modelToMarkUnhealthy: "",
      reason: "",
    };
  }
  const isRetryableFailure = isRetryableTaskFailure(input.raw);
  const tokenOrQuotaFailure = isTokenOrQuotaFailure(input.raw);
  const useModelFailover =
    tokenOrQuotaFailure &&
    input.config.dynamic_model.enabled &&
    input.config.dynamic_model.generate_variants;
  const isHardFailure =
    !isRetryableFailure &&
    (input.classifiedFailure === "verification_mismatch" ||
      input.classifiedFailure === "hypothesis_stall" ||
      input.classifiedFailure === "input_validation_non_retryable" ||
      input.classifiedFailure === "unsat_claim" ||
      input.classifiedFailure === "static_dynamic_contradiction" ||
      input.classifiedFailure === "exploit_chain" ||
      input.classifiedFailure === "environment");

  const outcome: "success" | "retryable_failure" | "hard_failure" = isRetryableFailure
    ? "retryable_failure"
    : isHardFailure
      ? "hard_failure"
      : "success";

  let modelToMarkUnhealthy = "";
  if (tokenOrQuotaFailure) {
    const lastSubagent = input.state.lastTaskSubagent;
    const model =
      input.state.lastTaskModel.trim().length > 0
        ? input.state.lastTaskModel.trim()
        : lastSubagent
          ? input.agentModel(lastSubagent)
          : undefined;
    modelToMarkUnhealthy = model ?? "";
  }

  return {
    shouldRecordOutcome: true,
    outcome,
    tokenOrQuotaFailure,
    useModelFailover,
    modelToMarkUnhealthy,
    reason: "rate_limit_or_quota",
  };
}

export interface FailoverAutoloopStageResult {
  armFailover: boolean;
  clearFailover: boolean;
  disableAutoloop: boolean;
  metricSignals: string[];
  failoverToastMessage: string;
  failoverNoteMessage: string;
  autoloopNoteMessage: string;
}

export function shapeTaskFailoverAutoloopStage(input: {
  state: SessionState;
  isRetryableFailure: boolean;
  useModelFailover: boolean;
  maxFailoverRetries: number;
  classifiedFailure: "none" | "verification_mismatch" | "tooling_timeout" | "context_overflow" | "input_validation_non_retryable" | "hypothesis_stall" | "unsat_claim" | "static_dynamic_contradiction" | "exploit_chain" | "environment";
}): FailoverAutoloopStageResult {
  const armFailover =
    input.isRetryableFailure &&
    !input.useModelFailover &&
    input.state.taskFailoverCount < input.maxFailoverRetries;
  const clearFailover = !input.isRetryableFailure && (input.state.pendingTaskFailover || input.state.taskFailoverCount > 0);
  const autoloopStopReason =
    input.classifiedFailure === "environment"
      ? "environment"
      : input.classifiedFailure === "input_validation_non_retryable"
        ? "input_validation_non_retryable"
        : null;
  const disableAutoloop = input.state.autoLoopEnabled && autoloopStopReason !== null;
  const autoloopMetricSignal =
    autoloopStopReason === "environment"
      ? "autoloop_disabled_environment"
      : autoloopStopReason === "input_validation_non_retryable"
        ? "autoloop_disabled_input_validation"
        : "";
  const autoloopNoteMessage =
    autoloopStopReason === "input_validation_non_retryable"
      ? "Auto loop disabled: input validation failure is non-retryable; fix the payload before retry."
      : "Auto loop disabled: environment-blocked task failure requires manual intervention before retry.";

  return {
    armFailover,
    clearFailover,
    disableAutoloop,
    metricSignals: disableAutoloop && autoloopMetricSignal ? [autoloopMetricSignal] : [],
    failoverToastMessage: `Next task will use fallback agent (attempt ${input.state.taskFailoverCount + 1}/${input.maxFailoverRetries}).`,
    failoverNoteMessage: `Auto failover armed: next task call will use fallback subagent (attempt ${input.state.taskFailoverCount + 1}/${input.maxFailoverRetries}).`,
    autoloopNoteMessage,
  };
}

export interface EvidenceLedgerIntent {
  event: string;
  evidenceType: "behavioral_runtime" | "dynamic_memory" | "acceptance_oracle" | "string_pattern" | "static_reverse";
  confidence: number;
  summary: string;
  orchestrationOnly?: boolean;
}

export function buildEvidenceLedgerIntentsStage(input: {
  verifyOutcome: VerifyOutcome | null;
  verifyFailDecoyReason: string;
  oracleProgressSummary: string;
  oracleProgressConfidence: number;
}): EvidenceLedgerIntent[] {
  const intents: EvidenceLedgerIntent[] = [];

  if (input.verifyOutcome) {
    if (input.verifyOutcome.kind === "verify_success") {
      intents.push({
        event: "verify_success",
        evidenceType: input.verifyOutcome.acceptanceOk ? "acceptance_oracle" : "behavioral_runtime",
        confidence: input.verifyOutcome.acceptanceOk ? 1 : 0.85,
        summary: input.verifyOutcome.normalizedSummary,
      });
    } else if (input.verifyOutcome.kind === "verify_fail") {
      intents.push({
        event: "verify_fail",
        evidenceType: input.verifyOutcome.contradictionDetected ? "dynamic_memory" : "behavioral_runtime",
        confidence: input.verifyOutcome.contradictionDetected ? 0.9 : 0.7,
        summary: input.verifyOutcome.normalizedSummary,
      });
    } else {
      intents.push({
        event: "verify_fail",
        evidenceType: input.verifyOutcome.contradictionDetected ? "dynamic_memory" : "behavioral_runtime",
        confidence: input.verifyOutcome.contradictionDetected ? 0.9 : 0.65,
        summary: input.verifyOutcome.taggedSummary,
      });
    }
  }

  if (input.verifyFailDecoyReason) {
    intents.push({
      event: "decoy_suspect",
      evidenceType: "string_pattern",
      confidence: 0.75,
      summary: `Verifier decoy suspect: ${input.verifyFailDecoyReason}`,
      orchestrationOnly: true,
    });
  }

  if (input.oracleProgressSummary) {
    intents.push({
      event: "oracle_progress",
      evidenceType: "behavioral_runtime",
      confidence: input.oracleProgressConfidence,
      summary: input.oracleProgressSummary,
      orchestrationOnly: true,
    });
  }

  return intents;
}

export function classifyVerifyFailDecoyStage(input: {
  raw: string;
  state: SessionState;
}): { decoyReason: string } | null {
  const flagCandidates = scanForFlags(input.raw, "verify_fail");
  const existingCandidates = input.state.latestCandidate
    ? [{ flag: input.state.latestCandidate, format: "", source: "candidate", confidence: "medium" as const, timestamp: Date.now() }]
    : [];
  const allCandidates = [...flagCandidates, ...existingCandidates];
  const decoyCheck = checkForDecoy(allCandidates, false);
  if (decoyCheck.isDecoySuspect && !input.state.decoySuspect) {
    return { decoyReason: decoyCheck.reason };
  }
  return null;
}

export function classifyFlagDetectorStage(input: {
  enabled: boolean;
  outputText: string;
  tool: string;
}): { flags: string[]; alert: string } | null {
  if (!input.enabled || input.outputText.length === 0 || input.outputText.length >= 100_000) {
    return null;
  }
  if (!containsFlag(input.outputText)) {
    return null;
  }
  const flags = scanForFlags(input.outputText, `tool:${input.tool}`);
  if (flags.length === 0) {
    return null;
  }
  return {
    flags: flags.map((item) => item.flag),
    alert: buildFlagAlert(flags),
  };
}

export function routeVerifierStage(input: {
  tool: string;
  lastTaskRoute: string;
  isVerificationSourceRelevant: boolean;
  raw: string;
  parseOracleProgressFromText: (text: string) => { passCount: number; failIndex: number; totalTests: number } | null;
}): {
  routeVerifier: boolean;
  verificationRelevant: boolean;
  parsedOracleProgress: { passCount: number; failIndex: number; totalTests: number } | null;
} {
  const lastRouteBase = input.lastTaskRoute;
  const routeVerifier = input.tool === "task" && (lastRouteBase === "ctf-verify" || lastRouteBase === "ctf-decoy-check");
  const verificationRelevant = routeVerifier || input.isVerificationSourceRelevant;
  const parsedOracleProgress =
    verificationRelevant || input.raw.includes("ORACLE_PROGRESS") ? input.parseOracleProgressFromText(input.raw) : null;
  return {
    routeVerifier,
    verificationRelevant,
    parsedOracleProgress,
  };
}

export function classifyFailureForMetricsStage(input: {
  classifiedFailure:
    | "none"
    | "verification_mismatch"
    | "tooling_timeout"
    | "context_overflow"
    | "input_validation_non_retryable"
    | "hypothesis_stall"
    | "unsat_claim"
    | "static_dynamic_contradiction"
    | "exploit_chain"
    | "environment";
  raw: string;
  failedRoute: string;
}): {
  shouldSetFailureDetails: boolean;
  setFailureReason: "hypothesis_stall" | "exploit_chain" | "environment" | "unsat_claim" | "static_dynamic_contradiction" | "input_validation_non_retryable" | "none";
  summary: string;
  failedRoute: string;
  metricSignal: string;
  event: "same_payload_repeat" | "no_new_evidence" | "none";
} {
  const summary = input.raw.replace(/\s+/g, " ").trim().slice(0, 240);
  if (input.classifiedFailure === "hypothesis_stall") {
    return {
      shouldSetFailureDetails: true,
      setFailureReason: "hypothesis_stall",
      summary,
      failedRoute: input.failedRoute,
      metricSignal: /(same payload|same_payload)/i.test(input.raw) ? "same_payload_repeat" : "no_new_evidence",
      event: /(same payload|same_payload)/i.test(input.raw) ? "same_payload_repeat" : "no_new_evidence",
    };
  }

  if (
    input.classifiedFailure === "exploit_chain" ||
    input.classifiedFailure === "environment" ||
    input.classifiedFailure === "unsat_claim" ||
    input.classifiedFailure === "static_dynamic_contradiction" ||
    input.classifiedFailure === "input_validation_non_retryable"
  ) {
    return {
      shouldSetFailureDetails: true,
      setFailureReason: input.classifiedFailure,
      summary,
      failedRoute: input.failedRoute,
      metricSignal: `failure:${input.classifiedFailure}`,
      event: "none",
    };
  }

  return {
    shouldSetFailureDetails: false,
    setFailureReason: "none",
    summary,
    failedRoute: input.failedRoute,
    metricSignal: "",
    event: "none",
  };
}
