import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import { resolveOpencodeDirCandidates } from "../config/opencode-config-path";
import { mergeCachedClaudeToolArgs } from "./claude-tool-call-cache";

const schema = tool.schema;
const MAX_SKILL_BYTES = 128 * 1024;

type SkillArgs = {
  name?: string;
  skill_name?: string;
  user_message?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function resolveRequestedSkillName(args: unknown): string | null {
  const input = mergeCachedClaudeToolArgs("aegis_skill", args);
  for (const key of ["skill_name", "skillName", "name"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function normalizeSkillName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return trimmed;
}

function resolveSkillCandidates(projectDir: string, skillName: string): string[] {
  const candidates: string[] = [
    join(projectDir, ".opencode", "skills", skillName, "SKILL.md"),
    join(projectDir, ".claude", "skills", skillName, "SKILL.md"),
  ];
  for (const dir of resolveOpencodeDirCandidates()) {
    candidates.push(join(dir, "skills", skillName, "SKILL.md"));
  }
  return candidates;
}

function loadSkillFile(projectDir: string, name: string): { ok: true; text: string; path: string } | { ok: false; reason: string } {
  const skillName = normalizeSkillName(name);
  if (!skillName) {
    return { ok: false, reason: "invalid skill name" };
  }

  const path = resolveSkillCandidates(projectDir, skillName).find((candidate) => existsSync(candidate));
  if (!path) {
    return { ok: false, reason: "skill not found" };
  }

  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      return { ok: false, reason: "skill is not a file" };
    }
    if (stat.size > MAX_SKILL_BYTES) {
      return { ok: false, reason: "skill file too large" };
    }
    return { ok: true, text: readFileSync(path, "utf-8"), path };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  }
}

function extractSkillBody(text: string): string {
  const templateMatch = text.match(/<skill-instruction>([\s\S]*?)<\/skill-instruction>/);
  return templateMatch ? templateMatch[1].trim() : text.trim();
}

function formatSkillOutput(skillName: string, skillPath: string, text: string): string {
  const baseDir = dirname(skillPath);
  const body = extractSkillBody(text);
  return [`## Skill: ${skillName}`, "", `**Base directory**: ${baseDir}`, "", body].join("\n");
}

function annotateTitle(context: ToolContext | undefined): void {
  if (typeof context?.metadata === "function") {
    context.metadata({ title: "aegis_skill" });
  }
}

export function createClaudeSafeSkillTool(projectDir: string): ToolDefinition {
  return tool({
    description: "Load a local skill file by name. Use name (preferred) or skill_name, plus optional user_message.",
    args: {
      name: schema.string().min(1),
      skill_name: schema.string().min(1).optional(),
      user_message: schema.string().optional(),
    },
    execute: async (args: SkillArgs, context) => {
      annotateTitle(context);
      const skillName = resolveRequestedSkillName(args);
      if (!skillName) {
        throw new Error("Skill name is required. Provide `name` or `skill_name`.");
      }

      const result = loadSkillFile(projectDir, skillName);
      if (!result.ok) {
        throw new Error(`Skill or command "${skillName}" not found. Reason: ${result.reason}`);
      }
      return formatSkillOutput(skillName, result.path, result.text);
    },
  });
}
