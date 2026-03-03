import type { AuthHook, PluginInput } from "@opencode-ai/plugin";
export declare function createGeminiCliAuthPlugin(_input: PluginInput): Promise<{
    auth: AuthHook;
}>;
export default createGeminiCliAuthPlugin;
