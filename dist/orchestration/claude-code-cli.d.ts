import { spawn as spawnNode } from "node:child_process";
export type ClaudeCodeCliResult = {
    ok: boolean;
    reason?: string;
    response_text?: string;
    exit_code?: number;
    stdout?: string;
    stderr?: string;
};
export type ClaudeCodeCliDeps = {
    spawnImpl?: typeof spawnNode;
    nowMs?: () => number;
};
export declare function runClaudeCodeCli(params: {
    prompt: string;
    model?: string;
    timeoutMs?: number;
    maxOutputChars?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    deps?: ClaudeCodeCliDeps;
}): Promise<ClaudeCodeCliResult>;
