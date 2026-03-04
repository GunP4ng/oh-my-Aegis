import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
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
export declare function evaluateCouncilPolicy(state: SessionState, config: OrchestratorConfig): CouncilPolicyDecision;
