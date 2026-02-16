export const memory = {
  type: "local" as const,
  command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
  environment: {
    MEMORY_FILE_PATH: ".Aegis/memory/memory.jsonl",
  },
  enabled: true,
};
