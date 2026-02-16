import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
export declare function discoverAvailableSkills(projectDir: string, environment?: NodeJS.ProcessEnv): Set<string>;
export declare function resolveAutoloadSkills(params: {
    state: SessionState;
    config: OrchestratorConfig;
    subagentType: string;
    availableSkills: Set<string>;
}): string[];
export declare function mergeLoadSkills(params: {
    existing: unknown;
    autoload: string[];
    maxSkills: number;
    availableSkills: Set<string>;
}): string[];
