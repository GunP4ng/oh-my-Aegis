import type { SessionStore } from "../../state/session-store";
import type { OrchestratorConfig } from "../../config/schema";
import type { Phase, SessionEvent } from "../../state/types";
import { resolve, relative, isAbsolute } from "node:path";

export const ensureInsideProject = (
  projectDir: string,
  candidatePath: string,
): { ok: true; abs: string } | { ok: false; reason: string } => {
  if (!candidatePath || !candidatePath.trim()) {
    return { ok: false, reason: "missing path" };
  }

  const root = resolve(projectDir);
  const abs = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(projectDir, candidatePath);
  const rel = relative(root, abs);

  if (!rel || rel === ".") {
    return { ok: true, abs };
  }

  if (rel.startsWith("..") || rel.includes(".." + "//") || rel.includes(".." + "\\")) {
    return { ok: false, reason: `path outside project: ${abs}` };
  }

  return { ok: true, abs };
};

export const defaultSharedMessageSource = (
  store: SessionStore,
  sessionID: string,
  explicit?: string,
): string => {
  const provided = typeof explicit === "string" ? explicit.trim() : "";
  if (provided) return provided;
  const state = store.get(sessionID);
  return (state.activeSolveLane ?? "").trim() || state.mode || "Aegis";
};

export const blockIfBountyScopeUnconfirmed = (
  store: SessionStore,
  sessionID: string,
  toolName: string,
): string | null => {
  const state = store.get(sessionID);
  if (state.mode !== "BOUNTY" || state.scopeConfirmed) {
    return null;
  }
  return JSON.stringify(
    {
      ok: false,
      reason: "bounty scope not confirmed",
      tool: toolName,
      sessionID,
    },
    null,
    2,
  );
};

export const isInteractiveEnabledForSession = (
  store: SessionStore,
  config: OrchestratorConfig,
  sessionID: string,
): boolean => {
  if (config.interactive.enabled) return true;
  const mode = store.get(sessionID).mode;
  if (mode === "CTF") return config.interactive.enabled_in_ctf;
  if (mode === "BOUNTY") return config.interactive.enabled_in_bounty;
  return false;
};

const EVENT_PHASE_RULES: Partial<Record<SessionEvent, Phase[]>> = {
  scan_completed: ["SCAN"],
  plan_completed: ["PLAN"],
  verify_success: ["VERIFY"],
  verify_fail: ["VERIFY"],
  submit_accepted: ["SUBMIT"],
  submit_rejected: ["SUBMIT"],
};

export const validateEventPhaseTransition = (
  event: SessionEvent,
  phase: Phase,
): string | null => {
  if (phase === "CLOSED") {
    return `${event} not valid in CLOSED phase`;
  }
  const allowed = EVENT_PHASE_RULES[event];
  if (!allowed || allowed.length === 0) return null;
  if (allowed.includes(phase)) return null;
  const label = allowed.length === 1 ? allowed[0] : allowed.join(" or ");
  return `${event} only valid in ${label} phase`;
};

export const normalizeSubagentType = (value: string | null | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) return undefined;
  return normalized;
};

export const isValidModelID = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(trimmed);
};

export const isValidVariantID = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[a-z0-9][a-z0-9._-]*$/i.test(trimmed);
};

export const modelIdFromModel = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes("/")) return "";
  const [, modelId] = trimmed.split("/", 2);
  return modelId?.trim() ?? "";
};
