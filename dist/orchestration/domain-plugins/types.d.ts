import type { SessionState, TargetType } from "../../state/types";
/**
 * Minimal interface for domain-specific orchestration plugins.
 * Actual plugin implementations are deferred to future work.
 * The router and contradiction handler will call these methods
 * instead of embedding domain logic directly.
 */
export interface DomainPlugin {
    readonly targetType: TargetType;
    /**
     * Returns true if a contradiction event should force an immediate
     * patch-and-dump pivot (extraction-first strategy).
     */
    requiresPatchDumpOnContradiction(): boolean;
    /**
     * Returns true if the oracle gate conditions are satisfied for
     * the current session state (allow moving to SUBMIT).
     */
    oracleGate(state: SessionState): boolean;
}
