import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyAegisConfig } from "../src/install/apply-config";

function main(): void {
  const distPluginPath = resolve(join(process.cwd(), "dist", "index.js"));
  if (!existsSync(distPluginPath)) {
    throw new Error(`Built plugin not found: ${distPluginPath}. Run 'bun run build' first.`);
  }

  const result = applyAegisConfig({
    pluginEntry: distPluginPath,
    backupExistingConfig: true,
  });

  const lines = [
    "oh-my-Aegis apply complete.",
    `- plugin path ensured: ${result.pluginEntry}`,
    `- OpenCode config updated: ${result.opencodePath}`,
    result.backupPath ? `- backup created: ${result.backupPath}` : "- backup skipped (new config)",
    `- Aegis config ensured: ${result.aegisPath}`,
    result.addedAgents.length > 0
      ? `- added missing subagents: ${result.addedAgents.join(", ")}`
      : "- subagent mappings already present",
    result.ensuredBuiltinMcps.length > 0
      ? `- ensured builtin MCPs: ${result.ensuredBuiltinMcps.join(", ")}`
      : "- builtin MCPs disabled by config",
    "- verify with: ctf_orch_readiness",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
