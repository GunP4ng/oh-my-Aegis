import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { stripJsonComments } from "../utils/json";

const TRIGGER_STATE_FIELDS = [
  "mode",
  "targetType",
  "decoySuspect",
  "interactiveEnabled",
  "sequentialThinkingActive",
  "sequentialThinkingToolName",
  "contradictionPatchDumpDone",
  "staleToolPatternLoops",
  "noNewEvidenceLoops",
  "contradictionPivotDebt",
] as const;

const TriggerStateFieldSchema = z.enum(TRIGGER_STATE_FIELDS);

const TriggerPatternSchema = z
  .object({
    modes: z.array(z.string()).optional(),
    targets: z.array(z.string()).optional(),
  })
  .strict();

const TriggerStateConditionSchema = z
  .object({
    field: TriggerStateFieldSchema,
    equals: z.union([z.string(), z.number(), z.boolean()]),
  })
  .strict();

const TriggerCounterConditionSchema = z
  .object({
    field: TriggerStateFieldSchema,
    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
  })
  .strict()
  .refine((value) => value.gt !== undefined || value.gte !== undefined || value.lt !== undefined || value.lte !== undefined, {
    message: "counter condition requires at least one comparator",
  });

const PlaybookTriggerSchema = z
  .object({
    pattern: TriggerPatternSchema.optional(),
    states: z.array(TriggerStateConditionSchema).default([]),
    counters: z.array(TriggerCounterConditionSchema).default([]),
  })
  .strict();

const PlaybookStateMutationSchema = z
  .object({
    flags: z.array(z.string()).default([]),
    events: z.array(z.string()).default([]),
  })
  .strict();

const PlaybookNextActionSchema = z
  .object({
    tool: z.string().optional(),
    route: z.string().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.tool) || Boolean(value.route), {
    message: "mandatory_next_action requires at least one of tool or route",
  });

const PlaybookRuleSchema = z
  .object({
    id: z.string().min(1),
    order: z.number().int(),
    lines: z.array(z.string()).min(1),
    trigger: PlaybookTriggerSchema,
    state_mutation: PlaybookStateMutationSchema,
    mandatory_next_action: PlaybookNextActionSchema,
  })
  .strict();

const PlaybookRegistrySchema = z
  .object({
    version: z.number().int(),
    base_rules: z.array(PlaybookRuleSchema),
    conditional_rules: z.array(PlaybookRuleSchema),
  })
  .strict();

export type PlaybookRegistry = z.infer<typeof PlaybookRegistrySchema>;
export type PlaybookRule = z.infer<typeof PlaybookRuleSchema>;

function isExistingDirectory(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function resolvePlaybooksRoot(baseDir: string): string {
  const candidates = [join(baseDir, "../playbooks"), join(baseDir, "../../playbooks")];
  for (const candidate of candidates) {
    if (isExistingDirectory(candidate)) {
      return candidate;
    }
  }
  throw new Error(`playbook-loader: failed to resolve playbooks directory; tried: ${candidates.join(", ")}`);
}

function playbooksRoot(): string {
  const baseDir = dirname(fileURLToPath(import.meta.url));
  return resolvePlaybooksRoot(baseDir);
}

function yamlFilesSorted(root: string): string[] {
  const stack = [root];
  const files: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (entry.isFile() && nextPath.endsWith(".yaml")) {
        files.push(nextPath);
      }
    }
  }
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function formatParseError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function parsePlaybookFile(path: string): PlaybookRegistry {
  const raw = readFileSync(path, "utf-8");

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (yamlError) {
    try {
      const stripped = stripJsonComments(raw);
      parsed = JSON.parse(stripped);
    } catch (jsonError) {
      throw new Error(
        `playbook-loader: failed to parse playbook file ${path}; yaml: ${formatParseError(yamlError)}; json_fallback: ${formatParseError(jsonError)}`
      );
    }
  }

  try {
    return parsePlaybookRegistry(parsed);
  } catch (error) {
    throw new Error(`playbook-loader: invalid playbook registry in ${path}: ${formatParseError(error)}`);
  }
}

export function parsePlaybookRegistry(input: unknown): PlaybookRegistry {
  return PlaybookRegistrySchema.parse(input);
}

function mergeRegistries(registries: PlaybookRegistry[]): PlaybookRegistry {
  const merged: PlaybookRegistry = {
    version: 1,
    base_rules: [],
    conditional_rules: [],
  };
  for (const registry of registries) {
    merged.base_rules.push(...registry.base_rules);
    merged.conditional_rules.push(...registry.conditional_rules);
  }
  merged.base_rules.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  merged.conditional_rules.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return merged;
}

let cachedRegistry: PlaybookRegistry | null = null;

export function loadPlaybookRegistry(): PlaybookRegistry {
  if (cachedRegistry) {
    return cachedRegistry;
  }
  const root = playbooksRoot();
  const files = yamlFilesSorted(root);
  const registries = files.map((path) => parsePlaybookFile(path));
  cachedRegistry = mergeRegistries(registries);
  return cachedRegistry;
}

export function resetPlaybookRegistryCacheForTests(): void {
  cachedRegistry = null;
}
