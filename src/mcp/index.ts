import { context7 } from "./context7";
import { grep_app } from "./grep-app";
import { createMemoryMcp } from "./memory";
import { sequential_thinking } from "./sequential-thinking";
import { websearch } from "./websearch";
import type { BuiltinMcpName } from "./types";

export { BuiltinMcpNameSchema, type BuiltinMcpName, type AnyMcpName, AnyMcpNameSchema } from "./types";

type RemoteMcpConfig = {
  type: "remote";
  url: string;
  enabled: boolean;
};

type LocalMcpConfig = {
  type: "local";
  command: string[];
  enabled: boolean;
  environment?: Record<string, string>;
};

export type BuiltinMcpConfig = RemoteMcpConfig | LocalMcpConfig;

export function createBuiltinMcps(params: {
  projectDir: string;
  disabledMcps?: string[];
  memoryStorageDir?: string;
}) {
  const disabledMcps = params.disabledMcps ?? [];
  const allBuiltinMcps: Record<BuiltinMcpName, BuiltinMcpConfig> = {
    context7,
    grep_app,
    websearch,
    memory: createMemoryMcp({ projectDir: params.projectDir, storageDir: params.memoryStorageDir }),
    sequential_thinking,
  };

  const mcps: Record<string, BuiltinMcpConfig> = {};
  for (const [name, config] of Object.entries(allBuiltinMcps)) {
    if (!disabledMcps.includes(name)) {
      mcps[name] = config;
    }
  }
  return mcps;
}
