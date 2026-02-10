import { context7 } from "./context7";
import { grep_app } from "./grep-app";
import type { BuiltinMcpName } from "./types";

export { BuiltinMcpNameSchema, type BuiltinMcpName, type AnyMcpName, AnyMcpNameSchema } from "./types";

const allBuiltinMcps: Record<BuiltinMcpName, { type: "remote"; url: string; enabled: boolean }> = {
  context7,
  grep_app,
};

export function createBuiltinMcps(disabledMcps: string[] = []) {
  const mcps: Record<string, { type: "remote"; url: string; enabled: boolean }> = {};
  for (const [name, config] of Object.entries(allBuiltinMcps)) {
    if (!disabledMcps.includes(name)) {
      mcps[name] = config;
    }
  }
  return mcps;
}
