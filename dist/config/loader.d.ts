import { type OrchestratorConfig } from "./schema";
export declare function loadConfig(projectDir: string, options?: {
    onWarning?: (msg: string) => void;
}): OrchestratorConfig;
