import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
export declare function buildTaskPlaybook(state: SessionState, config: OrchestratorConfig): string;
export declare function hasPlaybookMarker(prompt: string): boolean;
