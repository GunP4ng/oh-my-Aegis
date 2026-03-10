export type RouteDecisionCouncilRiskClass = "low" | "medium" | "high";
export interface RouteDecisionCouncil {
    required: boolean;
    blocked: boolean;
    riskClass: RouteDecisionCouncilRiskClass;
    triggerReasons: string[];
    decisionArtifactRef: string;
    decidedAt: number;
    outcome: "not_required" | "required_missing" | "required_recorded";
}
export interface RouteDecision {
    primary: string;
    reason: string;
    followups?: string[];
    council?: RouteDecisionCouncil;
}
