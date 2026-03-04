export type PatchOperation = "add" | "modify" | "delete" | "rename" | "binary";

export interface PatchBudgets {
  max_files: number;
  max_loc: number;
}

export interface PatchPolicy {
  budgets: PatchBudgets;
  allowed_operations: readonly PatchOperation[];
  allow_paths: readonly string[];
  deny_paths: readonly string[];
}

export interface ParsedPatchFile {
  oldPath: string | null;
  newPath: string | null;
  normalizedPath: string;
  operation: PatchOperation;
  added: number;
  removed: number;
  binary: boolean;
}

export interface ParsedUnifiedDiff {
  files: ParsedPatchFile[];
  fileCount: number;
  totalAdded: number;
  totalRemoved: number;
  totalLoc: number;
}

export type PatchParseResult =
  | { ok: true; value: ParsedUnifiedDiff }
  | { ok: false; reason: string };

export interface PatchPolicyDecision {
  allow: boolean;
  reasons: string[];
  normalizedPaths: string[];
  operations: PatchOperation[];
  stats: {
    files: number;
    total_loc: number;
    added: number;
    removed: number;
  };
}

function splitLines(input: string): string[] {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function trimQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function decodeDiffPathToken(raw: string): string {
  const trimmed = trimQuotes(raw.trim());
  if (trimmed === "/dev/null") {
    return "/dev/null";
  }
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }
  return trimmed;
}

export function normalizePatchPath(rawPath: string): { ok: true; path: string } | { ok: false; reason: string } {
  const replaced = rawPath.trim().replace(/\\/g, "/");
  if (!replaced) {
    return { ok: false, reason: "patch_path_empty" };
  }
  if (replaced === "/dev/null") {
    return { ok: false, reason: "patch_path_dev_null" };
  }
  if (replaced.startsWith("/")) {
    return { ok: false, reason: "patch_path_absolute_forbidden" };
  }
  if (/^[A-Za-z]:\//.test(replaced)) {
    return { ok: false, reason: "patch_path_absolute_forbidden" };
  }

  const segments = replaced.split("/");
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return { ok: false, reason: "patch_path_traversal_forbidden" };
    }
    normalized.push(segment);
  }

  if (normalized.length === 0) {
    return { ok: false, reason: "patch_path_empty" };
  }
  return { ok: true, path: normalized.join("/") };
}

function matchPathRule(path: string, rule: string): boolean {
  const ruleNorm = normalizePatchPath(rule);
  if (!ruleNorm.ok) {
    return false;
  }
  const target = ruleNorm.path;
  if (target.endsWith("/*")) {
    const prefix = target.slice(0, -1);
    return path.startsWith(prefix);
  }
  return path === target || path.startsWith(`${target}/`);
}

export function parseUnifiedDiffStrict(diffText: string): PatchParseResult {
  if (typeof diffText !== "string" || diffText.trim().length === 0) {
    return { ok: false, reason: "patch_diff_empty" };
  }

  const lines = splitLines(diffText);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) {
    return { ok: false, reason: "patch_diff_empty" };
  }
  if (!lines[firstContentIndex].startsWith("diff --git ")) {
    return { ok: false, reason: "patch_not_unified_diff" };
  }
  for (let i = 0; i < firstContentIndex; i += 1) {
    if (lines[i].trim().length > 0) {
      return { ok: false, reason: "patch_prose_prefix_forbidden" };
    }
  }

  const files: ParsedPatchFile[] = [];
  let i = firstContentIndex;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    if (!line.startsWith("diff --git ")) {
      return { ok: false, reason: "patch_ambiguous_multi_diff_input" };
    }

    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!header) {
      return { ok: false, reason: "patch_invalid_diff_header" };
    }

    const headerOld = decodeDiffPathToken(`a/${header[1]}`);
    const headerNew = decodeDiffPathToken(`b/${header[2]}`);
    i += 1;

    let oldPath: string | null = null;
    let newPath: string | null = null;
    let operation: PatchOperation = "modify";
    let added = 0;
    let removed = 0;
    let inHunk = false;
    let binary = false;

    while (i < lines.length) {
      const current = lines[i];
      if (current.startsWith("diff --git ")) {
        break;
      }

      if (current.startsWith("new file mode ")) {
        operation = "add";
        i += 1;
        continue;
      }
      if (current.startsWith("deleted file mode ")) {
        operation = "delete";
        i += 1;
        continue;
      }
      if (current.startsWith("rename from ")) {
        operation = "rename";
        oldPath = decodeDiffPathToken(current.slice("rename from ".length));
        i += 1;
        continue;
      }
      if (current.startsWith("rename to ")) {
        operation = "rename";
        newPath = decodeDiffPathToken(current.slice("rename to ".length));
        i += 1;
        continue;
      }
      if (current.startsWith("Binary files ") || current === "GIT binary patch") {
        binary = true;
        operation = "binary";
        i += 1;
        continue;
      }
      if (current.startsWith("--- ")) {
        const parsed = decodeDiffPathToken(current.slice(4));
        oldPath = parsed === "/dev/null" ? null : parsed;
        i += 1;
        continue;
      }
      if (current.startsWith("+++ ")) {
        const parsed = decodeDiffPathToken(current.slice(4));
        newPath = parsed === "/dev/null" ? null : parsed;
        i += 1;
        continue;
      }
      if (current.startsWith("index ") || current.startsWith("old mode ") || current.startsWith("new mode ")) {
        i += 1;
        continue;
      }
      if (current.startsWith("@@ ")) {
        inHunk = true;
        i += 1;
        continue;
      }
      if (inHunk) {
        if (current.startsWith("+")) {
          if (!current.startsWith("+++")) {
            added += 1;
          }
          i += 1;
          continue;
        }
        if (current.startsWith("-")) {
          if (!current.startsWith("---")) {
            removed += 1;
          }
          i += 1;
          continue;
        }
        if (current.startsWith(" ") || current.startsWith("\\")) {
          i += 1;
          continue;
        }
      }

      if (current.trim().length === 0) {
        i += 1;
        continue;
      }

      return { ok: false, reason: "patch_unexpected_content" };
    }

    const effectiveOld = oldPath ?? (headerOld === "/dev/null" ? null : headerOld);
    const effectiveNew = newPath ?? (headerNew === "/dev/null" ? null : headerNew);
    const effectivePathRaw =
      operation === "delete"
        ? effectiveOld
        : operation === "add" || operation === "rename" || operation === "binary"
          ? effectiveNew ?? effectiveOld
          : effectiveNew ?? effectiveOld;

    if (!effectivePathRaw) {
      return { ok: false, reason: "patch_missing_target_path" };
    }

    const normalized = normalizePatchPath(effectivePathRaw);
    if (!normalized.ok) {
      return { ok: false, reason: normalized.reason };
    }

    files.push({
      oldPath: effectiveOld,
      newPath: effectiveNew,
      normalizedPath: normalized.path,
      operation,
      added,
      removed,
      binary,
    });
  }

  if (files.length === 0) {
    return { ok: false, reason: "patch_no_files" };
  }

  const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
  const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
  const totalLoc = totalAdded + totalRemoved;
  return {
    ok: true,
    value: {
      files,
      fileCount: files.length,
      totalAdded,
      totalRemoved,
      totalLoc,
    },
  };
}

export function validateParsedPatchAgainstPolicy(parsed: ParsedUnifiedDiff, policy: PatchPolicy): PatchPolicyDecision {
  const reasons: string[] = [];
  const normalizedPaths = parsed.files.map((file) => file.normalizedPath);
  const operations = parsed.files.map((file) => file.operation);

  if (parsed.fileCount > policy.budgets.max_files) {
    reasons.push(`patch_budget_files_exceeded:${parsed.fileCount}>${policy.budgets.max_files}`);
  }
  if (parsed.totalLoc > policy.budgets.max_loc) {
    reasons.push(`patch_budget_loc_exceeded:${parsed.totalLoc}>${policy.budgets.max_loc}`);
  }

  for (const file of parsed.files) {
    if (!policy.allowed_operations.includes(file.operation)) {
      reasons.push(`patch_operation_blocked:${file.operation}:${file.normalizedPath}`);
    }

    for (const deny of policy.deny_paths) {
      if (matchPathRule(file.normalizedPath, deny)) {
        reasons.push(`patch_path_blocked:${file.normalizedPath}`);
        break;
      }
    }

    if (policy.allow_paths.length > 0) {
      const allowed = policy.allow_paths.some((allow) => matchPathRule(file.normalizedPath, allow));
      if (!allowed) {
        reasons.push(`patch_path_out_of_scope:${file.normalizedPath}`);
      }
    }
  }

  return {
    allow: reasons.length === 0,
    reasons,
    normalizedPaths,
    operations,
    stats: {
      files: parsed.fileCount,
      total_loc: parsed.totalLoc,
      added: parsed.totalAdded,
      removed: parsed.totalRemoved,
    },
  };
}

export function validateUnifiedDiffAgainstPolicy(diffText: string, policy: PatchPolicy):
  | { ok: true; parsed: ParsedUnifiedDiff; decision: PatchPolicyDecision }
  | { ok: false; reason: string; decision?: PatchPolicyDecision } {
  const parsed = parseUnifiedDiffStrict(diffText);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  const decision = validateParsedPatchAgainstPolicy(parsed.value, policy);
  if (!decision.allow) {
    return { ok: false, reason: decision.reasons[0] ?? "patch_policy_denied", decision };
  }
  return { ok: true, parsed: parsed.value, decision };
}
