import { spawn as spawnNode } from "node:child_process";
export type GeminiCliResult = {
    ok: boolean;
    reason?: string;
    response_text?: string;
    exit_code?: number;
    stdout?: string;
    stderr?: string;
    raw?: unknown;
    stats?: unknown;
};
export type GeminiCliDeps = {
    spawnImpl?: typeof spawnNode;
    nowMs?: () => number;
};
export declare function runGeminiCli(params: {
    prompt: string;
    model?: string;
    timeoutMs?: number;
    maxOutputChars?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    deps?: GeminiCliDeps;
}): Promise<GeminiCliResult>;
