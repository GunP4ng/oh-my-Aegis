import { applyAegisConfig } from "../install/apply-config";

const packageJson = await import("../../package.json");
const PACKAGE_NAME =
  typeof packageJson.name === "string" && packageJson.name.trim().length > 0
    ? packageJson.name
    : "oh-my-aegis";

export function printInstallHelp(): void {
  const lines = [
    "Usage:",
    "  oh-my-aegis install",
    "",
    "What it does:",
    "  - adds package plugin entry to opencode.json",
    "  - ensures required CTF/BOUNTY subagent model mappings",
    "  - ensures builtin MCP mappings (context7, grep_app)",
    "  - writes/merges ~/.config/opencode/oh-my-Aegis.json",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function runInstall(): number {
  try {
    const result = applyAegisConfig({
      pluginEntry: PACKAGE_NAME,
      backupExistingConfig: true,
    });

    const lines = [
      "oh-my-Aegis install complete.",
      `- plugin entry ensured: ${result.pluginEntry}`,
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
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`oh-my-Aegis install failed: ${message}\n`);
    return 1;
  }
}
