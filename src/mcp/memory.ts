import { isAbsolute, join, resolve } from "node:path";
import type { BuiltinMcpConfig } from "./index";

export function createMemoryMcp(params: {
  projectDir: string;
  storageDir?: string;
}): BuiltinMcpConfig {
  const storageDir = params.storageDir?.trim() ? params.storageDir.trim() : ".Aegis/memory";
  const absDir = isAbsolute(storageDir) ? storageDir : resolve(params.projectDir, storageDir);
  const filePath = join(absDir, "memory.jsonl");

  return {
    type: "local" as const,
    command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    environment: {
      MEMORY_FILE_PATH: filePath,
    },
    enabled: true,
  };
}
