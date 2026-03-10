import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
export declare function isStuck(state: SessionState, config?: OrchestratorConfig): boolean;
