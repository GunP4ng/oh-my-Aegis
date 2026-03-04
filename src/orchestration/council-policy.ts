import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";

const FILE_COUNT_RE = /(?:^|[^a-z])(files|file_count|max_files)\s*[:=]\s*(\d+)(?:$|[^a-z])/gi;
const LOC_RE = /(?:^|[^a-z])(loc|total_loc|max_loc)\s*[:=]\s*(\d+)(?:$|[^a-z])/gi;
const CRITICAL_TOUCH_RE =
  /(?:^|[^a-z])(critical_paths_touched|critical_path_touches|critical_touches|critical)\s*[:=]\s*(\d+)(?:$|[^a-z])/gi;
const RISK_SCORE_RE = /(?:^|[^a-z])(risk_score|risk)\s*[:=]\s*(\d+)(?:$|[^a-z])/gi;

export type CouncilRiskClass = "low" | "medium" | "high";

export interface CouncilPatchStats {
  proposalCount: number;
  fileCount: number;
  totalLoc: number;
  criticalPathTouches: number;
  riskScore: number;
}

export interface CouncilDecisionContract {
  required: boolean;
  blocked: boolean;
  riskClass: CouncilRiskClass;
  triggerReasons: string[];
  decisionArtifactRef: string;
  decidedAt: number;
  outcome: "not_required" | "required_missing" | "required_recorded";
}

export interface CouncilPolicyDecision {
  required: boolean;
  blocked: boolean;
  reason: string;
  contract: CouncilDecisionContract;
  stats: CouncilPatchStats;
}

function parseMaxMetric(refs: string[], regex: RegExp): number {
  let max = 0;
  for (const ref of refs) {
    regex.lastIndex = 0;
    let match = regex.exec(ref);
    while (match) {
      const parsed = Number.parseInt(match[2] ?? "0", 10);
      if (Number.isFinite(parsed) && parsed > max) {
        max = parsed;
      }
      match = regex.exec(ref);
    }
  }
  return max;
}

function clampRiskScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor(score)));
}

function computeSignalRiskScore(state: SessionState): number {
  let score = 0;
  score += state.verifyFailCount * 8;
  score += state.noNewEvidenceLoops * 6;
  score += state.samePayloadLoops * 6;
  score += state.staleToolPatternLoops * 5;
  score += Math.max(0, Math.floor(state.revRiskScore * 10));
  score += state.decoySuspect ? 12 : 0;
  score += state.contradictionArtifactLockActive ? 25 : 0;
  if (state.lastFailureReason === "static_dynamic_contradiction") score += 25;
  if (state.lastFailureReason === "exploit_chain") score += 20;
  if (state.lastFailureReason === "unsat_claim") score += 12;
  return clampRiskScore(score);
}

function classifyRisk(score: number, threshold: number): CouncilRiskClass {
  if (score >= threshold) {
    return "high";
  }
  if (score >= Math.max(1, threshold - 20)) {
    return "medium";
  }
  return "low";
}

function buildPatchStats(state: SessionState): CouncilPatchStats {
  const refs = state.governance.patch.proposalRefs;
  const parsedRiskScore = parseMaxMetric(refs, RISK_SCORE_RE);
  const signalRiskScore = computeSignalRiskScore(state);
  return {
    proposalCount: refs.length,
    fileCount: parseMaxMetric(refs, FILE_COUNT_RE),
    totalLoc: parseMaxMetric(refs, LOC_RE),
    criticalPathTouches: parseMaxMetric(refs, CRITICAL_TOUCH_RE),
    riskScore: clampRiskScore(Math.max(parsedRiskScore, signalRiskScore)),
  };
}

export function evaluateCouncilPolicy(
  state: SessionState,
  config: OrchestratorConfig
): CouncilPolicyDecision {
  const thresholds = config.council.thresholds;
  const stats = buildPatchStats(state);
  const riskClass = classifyRisk(stats.riskScore, thresholds.risk_score);
  const patchCandidatePresent =
    state.governance.patch.digest.trim().length > 0 || state.governance.patch.proposalRefs.length > 0;

  const triggerReasons: string[] = [];
  if (riskClass === "high") {
    triggerReasons.push(`risk_class=high(${stats.riskScore}>=${thresholds.risk_score})`);
  }
  if (stats.fileCount >= thresholds.max_files) {
    triggerReasons.push(`patch_files=${stats.fileCount}>=${thresholds.max_files}`);
  }
  if (stats.totalLoc >= thresholds.max_loc) {
    triggerReasons.push(`patch_loc=${stats.totalLoc}>=${thresholds.max_loc}`);
  }
  if (stats.criticalPathTouches >= thresholds.critical_paths_touched) {
    triggerReasons.push(
      `critical_paths_touched=${stats.criticalPathTouches}>=${thresholds.critical_paths_touched}`
    );
  }

  const required = config.council.enabled && patchCandidatePresent && triggerReasons.length > 0;
  const decisionArtifactRef = state.governance.council.decisionArtifactRef.trim();
  const decidedAt = state.governance.council.decidedAt;
  const hasDecisionArtifact = decisionArtifactRef.length > 0 && decidedAt > 0;
  const blocked = required && config.council.fail_closed && !hasDecisionArtifact;

  const contract: CouncilDecisionContract = {
    required,
    blocked,
    riskClass,
    triggerReasons,
    decisionArtifactRef,
    decidedAt,
    outcome: !required
      ? "not_required"
      : hasDecisionArtifact
        ? "required_recorded"
        : "required_missing",
  };

  if (!required) {
    return {
      required,
      blocked,
      reason: "Council gate skipped: trigger matrix not matched.",
      contract,
      stats,
    };
  }

  if (blocked) {
    return {
      required,
      blocked,
      reason: `Council gate blocked: missing decision artifact (decisionArtifactRef/decidedAt). Triggered by ${triggerReasons.join(
        ", "
      )}.`,
      contract,
      stats,
    };
  }

  return {
    required,
    blocked,
    reason: `Council gate satisfied: decision artifact recorded (${decisionArtifactRef}). Triggered by ${triggerReasons.join(
      ", "
    )}.`,
    contract,
    stats,
  };
}
