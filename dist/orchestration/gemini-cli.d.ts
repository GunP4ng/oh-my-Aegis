import { spawn as spawnNode } from "node:child_process";
export type PatchProposalEnvelope = {
    schema_version: 1;
    contract: "sandbox_patch_proposal";
    worker: "gemini_cli";
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
export type GeminiCliResult = {
    ok: boolean;
    reason?: string;
    response_text?: string;
    proposal_envelope?: PatchProposalEnvelope;
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
    allowMissingProposalContext?: boolean;
    cwd?: string;
    timeoutMs?: number;
    maxOutputChars?: number;
    env?: NodeJS.ProcessEnv;
    proposal_context?: PatchProposalContext;
    deps?: GeminiCliDeps;
}): Promise<GeminiCliResult>;
