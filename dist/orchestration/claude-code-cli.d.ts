import { spawn as spawnNode } from "node:child_process";
export type PatchProposalEnvelope = {
    schema_version: 1;
    contract: "sandbox_patch_proposal";
    worker: "claude_code_cli";
    run_id: string;
    manifest_ref: string;
    patch_diff_ref: string;
    sandbox_cwd: string;
    response_text: string;
};
export type PatchProposalContext = {
    sandbox_cwd: string;
    run_id: string;
    manifest_ref: string;
    patch_diff_ref: string;
};
export type ClaudeCodeCliResult = {
    ok: boolean;
    reason?: string;
    response_text?: string;
    proposal_envelope?: PatchProposalEnvelope;
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
    env?: NodeJS.ProcessEnv;
    proposal_context?: PatchProposalContext;
    deps?: ClaudeCodeCliDeps;
}): Promise<ClaudeCodeCliResult>;
