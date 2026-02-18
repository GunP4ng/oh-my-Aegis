import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import type { DispatchPlan } from "./parallel";
export interface ReconPhase {
    phase: number;
    name: string;
    tracks: DispatchPlan["tracks"];
}
/**
 * Phase 1 planning for asset discovery (subdomains and ports).
 */
export declare function planAssetDiscovery(target: string, scope?: string[]): ReconPhase;
/**
 * Phase 2 planning for live host probing and technology triage.
 */
export declare function planLiveHostTriage(target: string): ReconPhase;
/**
 * Phase 3 planning for endpoint/content discovery.
 */
export declare function planContentDiscovery(target: string): ReconPhase;
/**
 * Phase 4 planning for vulnerability-focused scanning.
 */
export declare function planVulnScan(target: string): ReconPhase;
/**
 * Build a multi-phase bounty recon dispatch plan.
 */
export declare function planReconPipeline(state: SessionState, config: OrchestratorConfig, target: string, options?: {
    scope?: string[];
    maxTracksPerPhase?: number;
    skipPhases?: number[];
}): DispatchPlan;
