import type { AuthHook, PluginInput } from "@opencode-ai/plugin";

import { createGeminiCliFetch } from "./fetch";

const GEMINI_CLI_PROVIDER_ID = "model_cli";

export async function createGeminiCliAuthPlugin(_input: PluginInput): Promise<{ auth: AuthHook }> {
  const authHook: AuthHook = {
    provider: GEMINI_CLI_PROVIDER_ID,
    loader: async () => {
      return {
        fetch: createGeminiCliFetch(),
        apiKey: "gemini-cli",
      };
    },
    methods: [
      {
        type: "api",
        label: "Gemini CLI (env)",
      },
    ],
  };

  return { auth: authHook };
}

export default createGeminiCliAuthPlugin;
