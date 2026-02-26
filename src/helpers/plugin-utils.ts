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

export function isAegisManagerDelegationTool(toolName: string): boolean {
  if (toolName === "task" || toolName === "todowrite") {
    return true;
  }
  if (toolName === "background_output" || toolName === "background_cancel") {
    return true;
  }
  if (toolName.startsWith("ctf_orch_") || toolName.startsWith("ctf_parallel_")) {
    return true;
  }
  if (toolName === "ctf_subagent_dispatch") {
    return true;
  }
  return false;
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
