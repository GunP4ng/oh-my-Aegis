import { runGeminiCli } from "../../orchestration/gemini-cli";
import { runClaudeCodeCli } from "../../orchestration/claude-code-cli";
export type GeminiCliFetchDeps = {
    runGeminiCliImpl?: typeof runGeminiCli;
    runClaudeCodeCliImpl?: typeof runClaudeCodeCli;
};
export type GeminiCliFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export declare function createGeminiCliFetch(deps?: GeminiCliFetchDeps): GeminiCliFetch;
