import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";

const ORACLE_IMPROVEMENT_COOLDOWN_MS = 10 * 60 * 1000;

export function isStuck(state: SessionState, config?: OrchestratorConfig): boolean {
  const now = Date.now();
  if (now - state.oracleProgressImprovedAt <= ORACLE_IMPROVEMENT_COOLDOWN_MS) {
    return false;
  }

  const threshold = config?.stuck_threshold ?? 2;
  return (
    state.noNewEvidenceLoops >= threshold ||
    state.samePayloadLoops >= threshold ||
    state.verifyFailCount >= threshold
  );
}
