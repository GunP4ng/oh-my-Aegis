export declare function runClaudeHook(params: {
    projectDir: string;
    hookName: "PreToolUse" | "PostToolUse";
    payload: Record<string, unknown>;
    timeoutMs: number;
}): Promise<{
    ok: true;
} | {
    ok: false;
    reason: string;
}>;
