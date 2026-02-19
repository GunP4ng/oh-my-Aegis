import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { applyAegisConfig, resolveAntigravityAuthPluginEntry } from "../src/install/apply-config";

function ensureSkill(opencodeDir: string, name: string, content: string): void {
  const base = join(opencodeDir, "skills", name);
  const path = join(base, "SKILL.md");
  if (existsSync(path)) {
    return;
  }
  mkdirSync(base, { recursive: true });
  writeFileSync(path, `${content.trim()}\n`, "utf-8");
}

function installSkillBundle(opencodeDir: string): string[] {
  const installed: string[] = [];

  ensureSkill(
    opencodeDir,
    "ctf-workflow",
    [
      "---",
      "name: ctf-workflow",
      "description: CTF SCAN -> PLAN -> EXECUTE workflow contract",
      "---",
      "",
      "MODE: CTF",
      "",
      "Rules:",
      "- SCAN: collect 3-8 verified observations + 2-4 hypotheses + cheapest disconfirm test",
      "- PLAN: pick 1 leading hypothesis + 1-3 alternatives; define stop conditions",
      "- EXECUTE: do exactly 1 TODO loop; record evidence; then stop",
      "- If verifier says Wrong/Fail: pivot immediately; do not mismatch-debug",
      "- Keep artifacts under .Aegis/artifacts and reference paths in notes",
    ].join("\n"),
  );
  installed.push("ctf-workflow");

  ensureSkill(
    opencodeDir,
    "bounty-workflow",
    [
      "---",
      "name: bounty-workflow",
      "description: Bounty scope-first, minimal-impact workflow",
      "---",
      "",
      "MODE: BOUNTY",
      "",
      "Rules:",
      "- Confirm in-scope targets before any active testing",
      "- Prefer read-only / minimal-impact validation",
      "- Avoid automated scanning unless explicitly allowed",
      "- Record reproducible steps and impact narrative",
    ].join("\n"),
  );
  installed.push("bounty-workflow");

  ensureSkill(
    opencodeDir,
    "rev-analysis",
    [
      "---",
      "name: rev-analysis",
      "description: Reverse engineering checklist",
      "---",
      "",
      "Checklist:",
      "- Identify file type, arch, protections, entrypoints",
      "- Prefer runtime-grounded evidence when outputs mismatch",
      "- Capture artifacts: strings/readelf/trace outputs to .Aegis/artifacts",
      "- When stuck: instrument to dump expected buffers instead of full solve",
    ].join("\n"),
  );
  installed.push("rev-analysis");

  ensureSkill(
    opencodeDir,
    "pwn-exploit",
    [
      "---",
      "name: pwn-exploit",
      "description: PWN exploit development guide",
      "---",
      "",
      "Checklist:",
      "- Establish deterministic local repro loop first",
      "- Identify primitive (leak/write/exec) and prove it",
      "- Use PTY for gdb/nc interactions when needed",
      "- Keep evidence minimal and reproducible",
    ].join("\n"),
  );
  installed.push("pwn-exploit");

  return installed;
}

async function main(): Promise<void> {
  const distPluginPath = resolve(join(process.cwd(), "dist", "index.js"));
  if (!existsSync(distPluginPath)) {
    throw new Error(`Built plugin not found: ${distPluginPath}. Run 'bun run build' first.`);
  }

  const antigravityAuthPluginEntry = await resolveAntigravityAuthPluginEntry();
  const result = applyAegisConfig({
    pluginEntry: distPluginPath,
    backupExistingConfig: true,
    antigravityAuthPluginEntry,
  });

  const opencodeDir = dirname(result.opencodePath);
  const ensuredSkills = installSkillBundle(opencodeDir);

  const lines = [
    "oh-my-Aegis apply complete.",
    `- plugin path ensured: ${result.pluginEntry}`,
    `- antigravity auth plugin ensured: ${antigravityAuthPluginEntry}`,
    "- openai codex auth plugin ensured: opencode-openai-codex-auth",
    `- OpenCode config updated: ${result.opencodePath}`,
    result.backupPath ? `- backup created: ${result.backupPath}` : "- backup skipped (new config)",
    `- Aegis config ensured: ${result.aegisPath}`,
    result.addedAgents.length > 0
      ? `- added missing subagents: ${result.addedAgents.join(", ")}`
      : "- subagent mappings already present",
    result.ensuredBuiltinMcps.length > 0
      ? `- ensured builtin MCPs: ${result.ensuredBuiltinMcps.join(", ")}`
      : "- builtin MCPs disabled by config",
    ensuredSkills.length > 0 ? `- ensured skills: ${ensuredSkills.join(", ")}` : "- skills unchanged",
    "- verify with: ctf_orch_readiness",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

await main();
