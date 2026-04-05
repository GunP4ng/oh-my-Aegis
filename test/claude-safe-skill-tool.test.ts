import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClaudeSafeSkillTool } from "../src/tools/claude-safe-skill-tool";

const roots: string[] = [];
const originalCacheDir = process.env.OPENCODE_CLAUDE_AUTH_TOOL_CALL_CACHE_DIR;

afterEach(() => {
  process.env.OPENCODE_CLAUDE_AUTH_TOOL_CALL_CACHE_DIR = originalCacheDir;
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function createProjectWithSkill(name: string, content: string): string {
  const projectDir = join(tmpdir(), `aegis-claude-safe-skill-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(projectDir);
  const skillDir = join(projectDir, ".opencode", "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
  return projectDir;
}

describe("claude-safe skill tool", () => {
  it("formats loaded skill output like the built-in skill tool", async () => {
    const projectDir = createProjectWithSkill("demo-skill", "Use this skill carefully.\n");
    const tool = createClaudeSafeSkillTool(projectDir);
    const execute = tool.execute as (args: unknown, ctx: unknown) => Promise<string>;

    const output = await execute({ skill_name: "demo-skill" }, {});

    expect(output).toContain("## Skill: demo-skill");
    expect(output).toContain(`**Base directory**: ${join(projectDir, ".opencode", "skills", "demo-skill")}`);
    expect(output).toContain("Use this skill carefully.");
  });

  it("throws when the requested skill does not exist", async () => {
    const projectDir = createProjectWithSkill("demo-skill", "Use this skill carefully.\n");
    const tool = createClaudeSafeSkillTool(projectDir);
    const execute = tool.execute as (args: unknown, ctx: unknown) => Promise<string>;

    await expect(execute({ skill_name: "missing-skill" }, {})).rejects.toThrow(
      'Skill or command "missing-skill" not found'
    );
  });

  it("falls back to the latest cached tool call args when execute receives an empty object", async () => {
    const projectDir = createProjectWithSkill("demo-skill", "Use this skill carefully.\n");
    const cacheDir = join(projectDir, ".cache", "claude-tool-calls");
    roots.push(cacheDir);
    mkdirSync(cacheDir, { recursive: true });
    process.env.OPENCODE_CLAUDE_AUTH_TOOL_CALL_CACHE_DIR = cacheDir;
    writeFileSync(
      join(cacheDir, "call_1.json"),
      `${JSON.stringify({ id: "call_1", name: "aegis_skill", arguments: { name: "demo-skill" } }, null, 2)}\n`,
      "utf-8"
    );

    const tool = createClaudeSafeSkillTool(projectDir);
    const execute = tool.execute as (args: unknown, ctx: unknown) => Promise<string>;

    const output = await execute({}, {});

    expect(output).toContain("## Skill: demo-skill");
    expect(output).toContain("Use this skill carefully.");
  });

  it("sets tool metadata title so the UI can avoid Unknown labels", async () => {
    const projectDir = createProjectWithSkill("demo-skill", "Use this skill carefully.\n");
    const tool = createClaudeSafeSkillTool(projectDir);
    const execute = tool.execute as (args: unknown, ctx: { metadata: (input: { title?: string }) => void }) => Promise<string>;
    const titles: string[] = [];

    await execute(
      { skill_name: "demo-skill" },
      { metadata: (input) => titles.push(input.title ?? "") }
    );

    expect(titles).toEqual(["aegis_skill"]);
  });
});
