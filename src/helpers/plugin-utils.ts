import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isRecord } from "../utils/is-record";
import type { TargetType } from "../state/types";

export function detectDockerParityRequirement(workdir: string): { required: boolean; reason: string } {
  const candidates = [
    join(workdir, "README.md"),
    join(workdir, "readme.md"),
    join(workdir, "Dockerfile"),
    join(workdir, "docker", "README.md"),
  ];
  const mustRunInDocker =
    /(?:must|should|required|need(?:ed)?)\s+(?:to\s+)?run\s+in\s+docker|docker\s+only|run\s+with\s+docker/i;

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      if (mustRunInDocker.test(raw)) {
        return {
          required: true,
          reason: `Docker parity required by ${relative(workdir, path)}`,
        };
      }
    } catch {
      continue;
    }
  }

  return { required: false, reason: "" };
}

export class AegisPolicyDenyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AegisPolicyDenyError";
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, "/");
}

export function globToRegExp(glob: string): RegExp {
  const normalized = normalizePathForMatch(glob);
  let pattern = "^";
  for (let i = 0; i < normalized.length; ) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          pattern += "(?:.*\\/)?";
          i += 3;
          continue;
        }
        pattern += ".*";
        i += 2;
        continue;
      }
      pattern += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      pattern += "[^/]";
      i += 1;
      continue;
    }
    pattern += escapeRegExp(ch);
    i += 1;
  }
  pattern += "$";
  return new RegExp(pattern);
}

export function normalizeToolName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 64);
}

export function maskSensitiveToolOutput(text: string): string {
  const patterns: RegExp[] = [
    /\b(authorization\s*:\s*bearer\s+)([^\s\r\n]+)/gi,
    /\b(x-api-key\s*:\s*)([^\s\r\n]+)/gi,
    /\b(api[_-]?key\s*[=:]\s*)([^\s\r\n]+)/gi,
    /\b(client[_-]?secret\s*[=:]\s*)([^\s\r\n]+)/gi,
    /\b(access[_-]?token\s*[=:]\s*)([^\s\r\n]+)/gi,
    /\b(refresh[_-]?token\s*[=:]\s*)([^\s\r\n]+)/gi,
    /\b(session[_-]?id\s*[=:]\s*)([^\s\r\n]+)/gi,
    /\b(cookie\s*:\s*)([^\r\n]+)/gi,
    /\bset-cookie\s*:\s*([^\r\n]+)/gi,
    /\b(password\s*[=:]\s*)([^\s\r\n]+)/gi,
  ];
  let out = text;
  for (const pattern of patterns) {
    out = out.replace(pattern, (_match, prefix: string) => `${prefix}[REDACTED]`);
  }
  return out;
}

export function isPathInsideRoot(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolvedPath);
  if (!rel) return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export function truncateWithHeadTail(text: string, headChars: number, tailChars: number): string {
  const safeHead = Math.max(0, Math.floor(headChars));
  const safeTail = Math.max(0, Math.floor(tailChars));
  if (text.length <= safeHead + safeTail + 64) {
    return text;
  }
  const head = text.slice(0, safeHead);
  const tail = safeTail > 0 ? text.slice(-safeTail) : "";
  return `${head}\n\n... [truncated] ...\n\n${tail}`;
}

export function extractArtifactPathHints(text: string): string[] {
  const normalized = text.replace(/\\/g, "/");
  const pathLikeRe =
    /(?:\.?\/?[A-Za-z0-9_\-.]+(?:\/[A-Za-z0-9_\-.]+)+\.(?:txt|log|json|md|yml|yaml|out|bin|elf|dump|pcap|pcapng|png|jpg|jpeg|gif|zip|tar|gz))/g;
  const matches = normalized.match(pathLikeRe) ?? [];
  const filtered = matches
    .map((item) => item.trim())
    .filter((item) => item.length > 3)
    .filter((item) => !item.startsWith("http://") && !item.startsWith("https://"));
  return [...new Set(filtered)].slice(0, 20);
}

export type ToolCapabilityClass =
  | "read_only_observe"
  | "orchestration_observe"
  | "orchestration_control"
  | "bounded_state_record"
  | "planning_state_transition"
  | "high_authority_transition"
  | "workspace_mutation"
  | "external_execution"
  | "interactive_control";

type DirectToolAccessOverride = "derive" | "allow" | "deny";

export interface ToolAccessProfile {
  capabilities: readonly ToolCapabilityClass[];
  manager?: DirectToolAccessOverride;
  planning?: DirectToolAccessOverride;
}

export type AegisGuidanceRole = "manager" | "planning" | "worker";

const MANAGER_ALLOWED_CAPABILITIES = new Set<ToolCapabilityClass>([
  "read_only_observe",
  "orchestration_observe",
  "orchestration_control",
  "bounded_state_record",
  "planning_state_transition",
]);

const PLANNING_ALLOWED_CAPABILITIES = new Set<ToolCapabilityClass>([
  "read_only_observe",
  "orchestration_observe",
  "planning_state_transition",
]);

const DIRECT_TOOL_ACCESS_BY_NAME: Record<string, ToolAccessProfile> = {
  task: { capabilities: ["orchestration_control"] },
  todowrite: { capabilities: ["orchestration_control"] },
  background_output: { capabilities: ["orchestration_observe"] },
  background_cancel: { capabilities: ["orchestration_control"] },
  question: { capabilities: ["orchestration_control"] },
  skill: { capabilities: ["read_only_observe"] },
  read: { capabilities: ["read_only_observe"] },
  webfetch: { capabilities: ["read_only_observe"] },
  aegis_bash: { capabilities: ["external_execution"], manager: "deny", planning: "deny" },
  aegis_glob: { capabilities: ["read_only_observe"] },
  aegis_skill: { capabilities: ["read_only_observe"] },
  aegis_read: { capabilities: ["read_only_observe"] },
  aegis_webfetch: { capabilities: ["read_only_observe"], planning: "deny" },
  glob: { capabilities: ["read_only_observe"] },
  grep: { capabilities: ["read_only_observe"] },
  ast_grep_search: { capabilities: ["read_only_observe"] },
  grep_app_searchGitHub: { capabilities: ["read_only_observe"] },
  session_list: { capabilities: ["orchestration_observe"] },
  session_read: { capabilities: ["orchestration_observe"] },
  session_search: { capabilities: ["orchestration_observe"] },
  session_info: { capabilities: ["orchestration_observe"] },
  memory_read_graph: { capabilities: ["orchestration_observe"] },
  memory_search_nodes: { capabilities: ["orchestration_observe"] },
  memory_open_nodes: { capabilities: ["orchestration_observe"] },
  sequential_thinking_sequentialthinking: { capabilities: ["orchestration_observe"] },
  lsp_goto_definition: { capabilities: ["read_only_observe"] },
  lsp_find_references: { capabilities: ["read_only_observe"] },
  lsp_symbols: { capabilities: ["read_only_observe"] },
  lsp_diagnostics: { capabilities: ["read_only_observe"] },
  lsp_prepare_rename: { capabilities: ["read_only_observe"] },
  ctf_ast_grep_search: { capabilities: ["read_only_observe"] },
  ctf_lsp_goto_definition: { capabilities: ["read_only_observe"] },
  ctf_lsp_find_references: { capabilities: ["read_only_observe"] },
  ctf_lsp_diagnostics: { capabilities: ["read_only_observe"] },
  ctf_orch_status: { capabilities: ["orchestration_observe"] },
  ctf_orch_event: { capabilities: ["planning_state_transition"] },
  ctf_subagent_dispatch: { capabilities: ["orchestration_control"] },
  ctf_patch_audit: { capabilities: ["read_only_observe"] },
  ctf_evidence_ledger: { capabilities: ["bounded_state_record"] },
  ctf_patch_propose: {
    capabilities: ["bounded_state_record"],
    manager: "deny",
    planning: "deny",
  },
  ctf_patch_review: {
    capabilities: ["high_authority_transition"],
    manager: "deny",
    planning: "deny",
  },
  ctf_patch_apply: {
    capabilities: ["high_authority_transition"],
    manager: "deny",
    planning: "deny",
  },
};

const DIRECT_TOOL_ACCESS_BY_PREFIX: Array<{ prefix: string; profile: ToolAccessProfile }> = [
  {
    prefix: "ctf_orch_",
    profile: { capabilities: ["orchestration_control"], planning: "deny" },
  },
  {
    prefix: "ctf_parallel_",
    profile: { capabilities: ["orchestration_control"], planning: "deny" },
  },
];

export function getToolAccessProfile(toolName: string): ToolAccessProfile | null {
  const direct = DIRECT_TOOL_ACCESS_BY_NAME[toolName];
  if (direct) {
    return direct;
  }
  for (const entry of DIRECT_TOOL_ACCESS_BY_PREFIX) {
    if (toolName.startsWith(entry.prefix)) {
      return entry.profile;
    }
  }
  return null;
}

function isProfileAllowedForRole(
  profile: ToolAccessProfile | null,
  role: "manager" | "planning",
): boolean {
  if (!profile) {
    return false;
  }

  const override = role === "manager" ? profile.manager : profile.planning;
  if (override === "allow") {
    return true;
  }
  if (override === "deny") {
    return false;
  }

  const allowedCapabilities = role === "manager" ? MANAGER_ALLOWED_CAPABILITIES : PLANNING_ALLOWED_CAPABILITIES;
  return profile.capabilities.every((capability) => allowedCapabilities.has(capability));
}

export function isAegisManagerAllowedTool(toolName: string): boolean {
  return isProfileAllowedForRole(getToolAccessProfile(toolName), "manager");
}

export function isAegisPlanningAllowedTool(toolName: string): boolean {
  return isProfileAllowedForRole(getToolAccessProfile(toolName), "planning");
}

const DIRECT_DISCOVERY_TOOL_FAMILIES: Array<{ label: string; tools: readonly string[] }> = [
  { label: "skill", tools: ["skill"] },
  { label: "read", tools: ["read"] },
  { label: "webfetch", tools: ["webfetch"] },
  { label: "glob", tools: ["glob"] },
  { label: "grep", tools: ["grep"] },
  { label: "ast_grep_search", tools: ["ast_grep_search"] },
  {
    label: "LSP",
    tools: ["lsp_goto_definition", "lsp_find_references", "lsp_symbols", "lsp_diagnostics", "lsp_prepare_rename"],
  },
];

function isAllowedForGuidanceRole(role: Exclude<AegisGuidanceRole, "worker">, toolName: string): boolean {
  return role === "manager" ? isAegisManagerAllowedTool(toolName) : isAegisPlanningAllowedTool(toolName);
}

export function getAllowedDirectDiscoveryToolLabels(role: Exclude<AegisGuidanceRole, "worker">): string[] {
  return DIRECT_DISCOVERY_TOOL_FAMILIES
    .filter((family) => family.tools.some((toolName) => isAllowedForGuidanceRole(role, toolName)))
    .map((family) => family.label);
}

export function getAllowedDirectDiscoveryToolSummary(role: Exclude<AegisGuidanceRole, "worker">): string {
  return getAllowedDirectDiscoveryToolLabels(role).join("/");
}

export function inProgressTodoCount(args: unknown): number {
  if (!isRecord(args)) {
    return 0;
  }
  const candidate = args.todos;
  if (!Array.isArray(candidate)) {
    return 0;
  }
  let count = 0;
  for (const todo of candidate) {
    if (!isRecord(todo)) {
      continue;
    }
    if (todo.status === "in_progress") {
      count += 1;
    }
  }
  return count;
}

export function todoStatusCounts(todos: unknown[]): { pending: number; inProgress: number; completed: number; open: number } {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  for (const todo of todos) {
    if (!isRecord(todo)) {
      continue;
    }
    const status = typeof todo.status === "string" ? todo.status : "";
    if (status === "pending") pending += 1;
    if (status === "in_progress") inProgress += 1;
    if (status === "completed") completed += 1;
  }
  return {
    pending,
    inProgress,
    completed,
    open: pending + inProgress,
  };
}

export const SYNTHETIC_START_TODO = "Start the next concrete TODO step.";
export const SYNTHETIC_CONTINUE_TODO = "Continue with the next TODO after updating the completed step.";
export const SYNTHETIC_BREAKDOWN_PREFIX = "Break down remaining work into smaller TODO #";

export function todoContent(todo: unknown): string {
  if (!todo || typeof todo !== "object" || Array.isArray(todo)) {
    return "";
  }
  const record = todo as Record<string, unknown>;
  return typeof record.content === "string" ? record.content : "";
}

export function isSyntheticTodoContent(content: string): boolean {
  return (
    content === SYNTHETIC_START_TODO ||
    content === SYNTHETIC_CONTINUE_TODO ||
    content.startsWith(SYNTHETIC_BREAKDOWN_PREFIX)
  );
}

export function textFromParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const data = part as Record<string, unknown>;
      if (data.type !== "text") {
        return "";
      }
      return typeof data.text === "string" ? data.text : "";
    })
    .join("\n")
    .trim();
}

export function textFromUnknown(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const data = value as Record<string, unknown>;
  const chunks: string[] = [];
  const keys = ["text", "content", "prompt", "input", "message", "query", "goal", "description"];

  for (const key of keys) {
    const item = data[key];
    if (typeof item === "string" && item.trim().length > 0) {
      chunks.push(item);
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const nested = item as Record<string, unknown>;
    if (typeof nested.text === "string" && nested.text.trim().length > 0) {
      chunks.push(nested.text);
    }
    if (typeof nested.content === "string" && nested.content.trim().length > 0) {
      chunks.push(nested.content);
    }
  }

  return chunks.join("\n");
}

export function detectTargetType(text: string): TargetType | null {
  const lower = text.toLowerCase();
  if (
    /(\bweb3\b|smart contract|solidity|evm|ethereum|foundry|hardhat|slither|reentrancy|erc20|defi|onchain|bridge)/i.test(
      lower
    )
  ) {
    return "WEB3";
  }
  if (/(\bweb\b|\bapi\b|http|graphql|rest|websocket|grpc|idor|xss|sqli)/i.test(lower)) return "WEB_API";
  if (/(\bpwn\b|heap|rop|shellcode|gdb|pwntools|format string|use-after-free)/i.test(lower)) return "PWN";
  if (/(\brev\b|reverse|decompile|ghidra|ida|radare|disasm|elf|packer)/i.test(lower)) return "REV";
  if (/(\bcrypto\b|cipher|rsa|aes|hash|ecc|curve|lattice|padding oracle)/i.test(lower)) return "CRYPTO";
  if (
    /(\bforensics\b|pcap|pcapng|disk image|memory dump|volatility|wireshark|evtx|mft|registry hive|timeline|carv)/i.test(
      lower
    )
  ) {
    return "FORENSICS";
  }
  if (/(\bmisc\b|steg|osint|encoding|puzzle|logic)/i.test(lower)) return "MISC";
  return null;
}
