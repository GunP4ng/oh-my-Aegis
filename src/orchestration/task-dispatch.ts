import type { OrchestratorConfig } from "../config/schema";
import { agentModel, baseAgentName, resolveHealthyModel } from "./model-health";
import { DEFAULT_ROUTING } from "../config/schema";
import type { Mode, SessionState, TargetType } from "../state/types";
import { buildTaskPlaybook, hasPlaybookMarker } from "./playbook";
import { resolveAgentExecutionProfile, isModelHealthy } from "./model-health";
import { resolveAutoloadSkills, mergeLoadSkills } from "../skills/autoload";
import { isStuck } from "./router";
import { isLowConfidenceCandidate } from "../risk/sanitize";
import { getAllowedDirectDiscoveryToolSummary } from "../helpers/plugin-utils";

export interface TaskDispatchDecision {
  subagent_type?: string;
  model?: string;
  reason: string;
}

export const NON_OVERRIDABLE_ROUTE_AGENTS = new Set([
  "ctf-verify",
  "ctf-decoy-check",
  "bounty-scope",
  "md-scribe",
  "aegis-plan--governance-review-required",
  "aegis-plan--governance-council-required",
  "aegis-exec--governance-apply-ready",
]);

export function isNonOverridableSubagent(name: string): boolean {
  if (!name) {
    return false;
  }
  if (NON_OVERRIDABLE_ROUTE_AGENTS.has(name)) {
    return true;
  }
  return NON_OVERRIDABLE_ROUTE_AGENTS.has(baseAgentName(name));
}

const ROUTE_AGENT_MAP: Record<string, string> = {
  "aegis-plan": "aegis-plan",
  "aegis-exec": "aegis-exec",
  "aegis-deep": "aegis-deep",
  "bounty-scope": "bounty-scope",
  "ctf-web": "ctf-web",
  "ctf-web3": "ctf-web3",
  "ctf-pwn": "ctf-pwn",
  "ctf-rev": "ctf-rev",
  "ctf-crypto": "ctf-crypto",
  "ctf-forensics": "ctf-forensics",
  "ctf-explore": "ctf-explore",
  "ctf-solve": "ctf-solve",
  "ctf-research": "ctf-research",
  "ctf-hypothesis": "ctf-hypothesis",
  "ctf-decoy-check": "ctf-decoy-check",
  "ctf-verify": "ctf-verify",
  "bounty-triage": "bounty-triage",
  "bounty-research": "bounty-research",
  "deep-plan": "deep-plan",
  "md-scribe": "md-scribe",
  "aegis-explore": "aegis-explore",
  "aegis-librarian": "aegis-librarian",
};

function currentRouting(config?: OrchestratorConfig) {
  return config?.routing ?? DEFAULT_ROUTING;
}

export function requiredDispatchSubagents(config?: OrchestratorConfig): string[] {
  const routing = currentRouting(config);
  const required = new Set<string>(Object.values(ROUTE_AGENT_MAP));

  for (const domain of [routing.ctf, routing.bounty]) {
    for (const phase of [domain.scan, domain.plan, domain.execute, domain.stuck, domain.failover]) {
      for (const routeName of Object.values(phase)) {
        required.add(ROUTE_AGENT_MAP[routeName] ?? routeName);
      }
    }
  }

  return [...required];
}

function fallbackFor(mode: Mode, targetType: TargetType, config?: OrchestratorConfig): string {
  const routing = currentRouting(config);
  if (mode === "CTF") {
    return routing.ctf.failover[targetType];
  }
  return routing.bounty.failover[targetType];
}

const SESSION_METRIC_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function dispatchScore(state: SessionState, subagentType: string): number {
  const health = state.dispatchHealthBySubagent[subagentType];
  if (!health) {
    return 0;
  }
  const now = Date.now();
  const isRecent = health.lastOutcomeAt > 0 && now - health.lastOutcomeAt <= SESSION_METRIC_WINDOW_MS;
  const weight = isRecent ? 1.0 : 0.1;
  const rawScore =
    health.successCount * 2 -
    health.retryableFailureCount -
    health.hardFailureCount * 2 -
    health.consecutiveFailureCount * 3;
  return rawScore * weight;
}

function capabilityCandidates(state: SessionState, config?: OrchestratorConfig): string[] {
  if (!config) {
    return [];
  }
  const profile =
    state.mode === "CTF"
      ? config.capability_profiles.ctf[state.targetType]
      : config.capability_profiles.bounty[state.targetType];
  return profile.required_subagents;
}

function chooseOperationalSubagent(
  routePrimary: string,
  state: SessionState,
  mappedSubagent: string,
  config?: OrchestratorConfig
): TaskDispatchDecision {
  const threshold = config?.auto_dispatch.operational_feedback_consecutive_failures ?? 2;
  const mappedHealth = state.dispatchHealthBySubagent[mappedSubagent];
  if (!mappedHealth || mappedHealth.consecutiveFailureCount < threshold) {
    return {
      subagent_type: mappedSubagent,
      reason: `route '${routePrimary}' mapped to subagent '${mappedSubagent}'`,
    };
  }

  const pool: string[] = [];
  const pushUnique = (value: string) => {
    if (value && !pool.includes(value)) {
      pool.push(value);
    }
  };

  pushUnique(mappedSubagent);
  pushUnique(fallbackFor(state.mode, state.targetType, config));
  for (const candidate of capabilityCandidates(state, config)) {
    pushUnique(candidate);
  }

  let best = mappedSubagent;
  let bestScore = dispatchScore(state, mappedSubagent);
  for (const candidate of pool) {
    if (candidate === mappedSubagent) {
      continue;
    }
    const score = dispatchScore(state, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (best === mappedSubagent) {
    return {
      subagent_type: mappedSubagent,
      reason: `mapped subagent '${mappedSubagent}' retained despite failure streak (${mappedHealth.consecutiveFailureCount}).`,
    };
  }

  return {
    subagent_type: best,
    reason: `operational feedback switched '${mappedSubagent}' -> '${best}' after ${mappedHealth.consecutiveFailureCount} consecutive failures`,
  };
}

export function decideAutoDispatch(
  routePrimary: string,
  state: SessionState,
  maxFailoverRetries: number,
  config?: OrchestratorConfig
): TaskDispatchDecision {
  const dynamicModelEnabled = Boolean(
    config?.dynamic_model?.enabled && config?.dynamic_model?.generate_variants
  );
  const modelCooldownMs = config?.dynamic_model?.health_cooldown_ms ?? 300_000;
  const maybeApplyModelFailover = (decision: TaskDispatchDecision): TaskDispatchDecision => {
    if (!dynamicModelEnabled || !decision.subagent_type) {
      return decision;
    }
    if (isNonOverridableSubagent(decision.subagent_type)) {
      return decision;
    }
    const primaryModel = agentModel(decision.subagent_type);
    if (!primaryModel) {
      return decision;
    }
    const resolvedModel = resolveHealthyModel(decision.subagent_type, state, modelCooldownMs, config?.dynamic_model?.role_profiles, config?.dynamic_model?.agent_model_overrides);
    if (!resolvedModel || resolvedModel === primaryModel) {
      return decision;
    }
    return {
      ...decision,
      model: resolvedModel,
      reason: `${decision.reason}; model-failover '${primaryModel}' -> '${resolvedModel}'`,
    };
  };

  if (state.pendingTaskFailover && state.taskFailoverCount < maxFailoverRetries) {
    const fallback = fallbackFor(state.mode, state.targetType, config);
    return maybeApplyModelFailover({
      subagent_type: fallback,
      reason: `pending failover retry (${state.taskFailoverCount + 1}/${maxFailoverRetries}) after tool failure`,
    });
  }

  const mapped = ROUTE_AGENT_MAP[routePrimary] ?? routePrimary;
  if (!mapped) {
    return {
      reason: "no route-agent mapping found",
    };
  }

  if (isNonOverridableSubagent(mapped)) {
    return {
      subagent_type: mapped,
      reason: `route '${routePrimary}' is non-overridable and pinned to '${mapped}'`,
    };
  }

  const baseDecision = !config?.auto_dispatch.operational_feedback_enabled
    ? { subagent_type: mapped, reason: `route '${routePrimary}' mapped to subagent '${mapped}'` }
    : chooseOperationalSubagent(routePrimary, state, mapped, config);

  return maybeApplyModelFailover(baseDecision);
}

const SESSION_CONTEXT_MARKER = "[oh-my-Aegis session-context]";
const SEARCH_MODE_MARKER = "[oh-my-Aegis search-mode]";
const AUTO_PARALLEL_MARKER = "[oh-my-Aegis auto-parallel]";

export interface NoteInstruction {
  key: string;
  message: string;
}

export type StoreInstruction =
  | { type: "setLastTaskCategory"; value: string }
  | {
    type: "setLastDispatch";
    route: string;
    subagent: string;
    model?: string;
    variant?: string;
  }
  | { type: "consumeTaskFailover" }
  | { type: "setThinkMode"; value: "none" }
  | { type: "appendRecentEvent"; value: string; cap: number };

export interface TaskPromptContextInput {
  args: Record<string, unknown>;
  state: SessionState;
  godModeEnabled: boolean;
}

export interface TaskPromptContextResult {
  args: Record<string, unknown>;
}

export function shapeTaskPromptContext(input: TaskPromptContextInput): TaskPromptContextResult {
  const args = input.args;
  const existingPrompt = typeof args.prompt === "string" ? args.prompt : "";
  const promptWithDefault =
    existingPrompt.trim().length > 0
      ? existingPrompt
      : "Continue orchestration by following the active mode and phase.";
  if (!promptWithDefault.includes(SESSION_CONTEXT_MARKER)) {
    const sessionContextLines = [
      SESSION_CONTEXT_MARKER,
      `MODE: ${input.state.mode}`,
      `PHASE: ${input.state.phase}`,
      `TARGET: ${input.state.targetType}`,
    ];
    if (input.godModeEnabled) {
      sessionContextLines.push("GOD_MODE: enabled (destructive commands still require confirmation)");
    }
    if (input.state.mode === "BOUNTY") {
      sessionContextLines.push(input.state.scopeConfirmed ? "scope_confirmed" : "scope_unconfirmed");
    }
    args.prompt = `${sessionContextLines.join("\n")}\n\n${promptWithDefault}`;
  } else {
    args.prompt = promptWithDefault;
  }
  return { args };
}

export interface TaskDispatchShapingInput {
  args: Record<string, unknown>;
  state: SessionState;
  config: OrchestratorConfig;
  callerAgent: string;
  sessionID: string;
  decisionPrimary: string;
  searchModeRequested: boolean;
  searchModeGuidancePending: boolean;
  hasActiveParallelGroup: boolean;
  availableSkills: Set<string>;
  isWindows: boolean;
  resolveSharedChannelPrompt: (subagentType: string) => string;
}

export interface TaskDispatchShapingResult {
  args: Record<string, unknown>;
  notes: NoteInstruction[];
  storeInstructions: StoreInstruction[];
  clearSearchModeGuidancePending: boolean;
}

export function shapeTaskDispatch(input: TaskDispatchShapingInput): TaskDispatchShapingResult {
  const args = input.args;
  const notes: NoteInstruction[] = [];
  const storeInstructions: StoreInstruction[] = [];
  let clearSearchModeGuidancePending = false;

  const shouldInjectSearchModeGuidance =
    input.callerAgent === "aegis" && input.searchModeRequested && input.searchModeGuidancePending;
  if (
    shouldInjectSearchModeGuidance &&
    typeof args.prompt === "string" &&
    !args.prompt.includes(SEARCH_MODE_MARKER)
  ) {
    args.prompt = [
      args.prompt,
      "",
      SEARCH_MODE_MARKER,
      "- Immediately plan delegation-first fan-out.",
      "- Always run ctf_parallel_dispatch plan=scan (local fan-out).",
      "- Always run ctf_subagent_dispatch type=librarian with a focused external-reference query.",
      "- Skip extra explore dispatch only when target is CTF and the parallel scan already includes a ctf-explore track.",
      "- After dispatch, run ctf_parallel_collect message_limit=5 and pick a winner when evidence is clear.",
      `- Safe direct discovery tools are allowed from Aegis manager when they unblock routing (${getAllowedDirectDiscoveryToolSummary("manager")}).`,
      "- Do not call edit/bash directly from Aegis manager.",
    ].join("\n");
    clearSearchModeGuidancePending = true;
    notes.push({
      key: "search_mode.inject",
      message: `Search-mode guidance injected: session=${input.sessionID}`,
    });
  }

  const routePinned = isNonOverridableSubagent(input.decisionPrimary);
  const userCategory = typeof args.category === "string" ? args.category : "";
  const userSubagent = typeof args.subagent_type === "string" ? args.subagent_type : "";
  let dispatchModel = "";

  const hasAutoParallelMarker =
    typeof args.prompt === "string" && args.prompt.includes(AUTO_PARALLEL_MARKER);
  const hasUserTaskOverride =
    (typeof args.subagent_type === "string" && args.subagent_type.trim().length > 0) ||
    (typeof args.category === "string" && args.category.trim().length > 0) ||
    (typeof args.model === "string" && args.model.trim().length > 0) ||
    (typeof args.variant === "string" && args.variant.trim().length > 0);
  const ctfScanRouteSet = new Set(
    Object.values(input.config.routing.ctf.scan).map((name) => baseAgentName(String(name)))
  );
  const bountyScanRouteSet = new Set(
    Object.values(input.config.routing.bounty.scan).map((name) => baseAgentName(String(name)))
  );
  const basePrimary = baseAgentName(input.decisionPrimary);
  const hasPrimaryProfileOverride = Boolean(input.state.subagentProfileOverrides[basePrimary]);
  const alternatives = input.state.alternatives
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 3);

  const isCtfParallelScanCandidate =
    input.state.mode === "CTF" && ctfScanRouteSet.has(basePrimary);
  const isBountyParallelScanCandidate =
    input.state.mode === "BOUNTY" && input.state.scopeConfirmed && bountyScanRouteSet.has(basePrimary);

  const shouldAutoParallelScan =
    input.config.parallel.auto_dispatch_scan &&
    (isCtfParallelScanCandidate || isBountyParallelScanCandidate) &&
    input.state.phase === "SCAN" &&
    !input.state.pendingTaskFailover &&
    input.state.taskFailoverCount === 0 &&
    !hasUserTaskOverride &&
    !hasPrimaryProfileOverride &&
    !input.hasActiveParallelGroup &&
    !hasAutoParallelMarker;

  // Detect immediate PLAN→EXECUTE transition: auto-trigger parallel hypothesis testing
  const justTransitionedToExecute =
    input.state.mode === "CTF" &&
    input.state.phase === "EXECUTE" &&
    input.state.recentEvents.includes("plan_completed") &&
    alternatives.length >= 2 &&
    !input.state.pendingTaskFailover;

  let shouldAutoParallelHypothesis =
    input.config.parallel.auto_dispatch_hypothesis &&
    input.state.mode === "CTF" &&
    input.state.phase !== "SCAN" &&
    basePrimary === "ctf-hypothesis" &&
    !input.state.pendingTaskFailover &&
    !hasUserTaskOverride &&
    alternatives.length >= 2 &&
    !input.hasActiveParallelGroup &&
    !hasAutoParallelMarker;

  if (
    justTransitionedToExecute &&
    input.config.parallel.auto_dispatch_hypothesis &&
    !hasUserTaskOverride &&
    !input.hasActiveParallelGroup &&
    !hasAutoParallelMarker
  ) {
    shouldAutoParallelHypothesis = true;
  }

  const shouldAutoParallelDeepWorker =
    input.state.mode === "CTF" &&
    (input.state.targetType === "REV" || input.state.targetType === "PWN") &&
    input.state.phase === "EXECUTE" &&
    !input.state.pendingTaskFailover &&
    input.state.taskFailoverCount === 0 &&
    !hasUserTaskOverride &&
    !hasPrimaryProfileOverride &&
    !input.hasActiveParallelGroup &&
    !hasAutoParallelMarker;

  const autoParallelForced =
    shouldAutoParallelScan || shouldAutoParallelHypothesis || shouldAutoParallelDeepWorker;

  if (autoParallelForced) {
    const userPrompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    const basePrompt = userPrompt.length > 0 ? userPrompt : "Continue CTF orchestration with delegated tracks.";

    if (shouldAutoParallelScan) {
      const autoParallelMode = input.state.mode === "BOUNTY" ? "BOUNTY" : "CTF";
      const safetyLine =
        input.state.mode === "BOUNTY"
          ? "- Keep actions scope-safe and minimal-impact during scan tracks."
          : "- Do not run direct domain execution before dispatch.";
      args.prompt = [
        basePrompt,
        "",
        AUTO_PARALLEL_MARKER,
        `mode=${autoParallelMode} phase=SCAN`,
        "- Immediately run ctf_parallel_dispatch plan=scan with challenge_description derived from available context.",
        safetyLine,
        "- While tracks run, check ctf_parallel_status and then merge with ctf_parallel_collect.",
        "- Choose winner when clear, then update plan + TODO list (multiple todos allowed, one in_progress).",
      ].join("\n");
    } else if (shouldAutoParallelHypothesis) {
      const hypothesesPayload = JSON.stringify(
        alternatives.map((hypothesis) => ({
          hypothesis,
          disconfirmTest: "Run one cheapest disconfirm test and return verifier-aligned evidence.",
        }))
      );
      args.prompt = [
        basePrompt,
        "",
        AUTO_PARALLEL_MARKER,
        "mode=CTF phase=PLAN_OR_EXECUTE",
        "- Immediately run ctf_parallel_dispatch plan=hypothesis with the provided hypotheses JSON.",
        `- hypotheses=${hypothesesPayload}`,
        "- While tracks run, check ctf_parallel_status and then merge with ctf_parallel_collect.",
        "- Declare winner if clear, then update plan + TODO list (multiple todos allowed, one in_progress).",
      ].join("\n");
    } else {
      const goal =
        typeof args.prompt === "string" && args.prompt.trim().length > 0
          ? args.prompt.trim().slice(0, 2000)
          : `Deep parallel analysis for ${input.state.targetType} in EXECUTE phase.`;
      args.prompt = [
        basePrompt,
        "",
        AUTO_PARALLEL_MARKER,
        "mode=CTF phase=EXECUTE",
        `- Immediately run ctf_parallel_dispatch plan=deep_worker goal=${JSON.stringify(goal)}.`,
        "- Launch static and dynamic tracks in parallel and collect with ctf_parallel_collect.",
        "- Pick winner when clear, then update TODO list and proceed with one in_progress item.",
      ].join("\n");
    }

    args.subagent_type = "aegis-deep";
    if ("category" in args) {
      delete args.category;
    }
    storeInstructions.push({ type: "setLastTaskCategory", value: "aegis-deep" });
    storeInstructions.push({
      type: "setLastDispatch",
      route: input.decisionPrimary,
      subagent: "aegis-deep",
    });
    notes.push({
      key: "task.auto_parallel",
      message: `Auto parallel dispatch armed: session=${input.sessionID} scan=${shouldAutoParallelScan} hypothesis=${shouldAutoParallelHypothesis} deep_worker=${shouldAutoParallelDeepWorker}`,
    });
  }

  if (input.config.auto_dispatch.enabled && !autoParallelForced) {
    const dispatch = decideAutoDispatch(
      input.decisionPrimary,
      input.state,
      input.config.auto_dispatch.max_failover_retries,
      input.config
    );
    dispatchModel = typeof dispatch.model === "string" ? dispatch.model.trim() : "";
    const hasUserCategory = typeof args.category === "string" && args.category.length > 0;
    const hasUserSubagent =
      typeof args.subagent_type === "string" && args.subagent_type.length > 0;
    const shouldForceFailover = input.state.pendingTaskFailover;
    const hasUserDispatch = hasUserCategory || hasUserSubagent;
    const shouldSetSubagent =
      Boolean(dispatch.subagent_type) &&
      (routePinned ||
        shouldForceFailover ||
        !input.config.auto_dispatch.preserve_user_category ||
        !hasUserDispatch);

    if (dispatch.subagent_type && shouldSetSubagent) {
      const forced = routePinned ? input.decisionPrimary : dispatch.subagent_type;
      if (routePinned && (userCategory || userSubagent) && (userSubagent !== forced || userCategory)) {
        notes.push({
          key: "task.pin",
          message: `policy-pin task: route=${input.decisionPrimary} mode=${input.state.mode} scopeConfirmed=${input.state.scopeConfirmed} user_category=${userCategory || "(none)"} user_subagent=${userSubagent || "(none)"}`,
        });
      }
      args.subagent_type = forced;
      if ("category" in args) {
        delete args.category;
      }
      storeInstructions.push({ type: "setLastTaskCategory", value: forced });
      storeInstructions.push({
        type: "setLastDispatch",
        route: input.decisionPrimary,
        subagent: forced,
      });

      if (shouldForceFailover) {
        storeInstructions.push({ type: "consumeTaskFailover" });
      }
    }

    const requestedAgent =
      typeof args.subagent_type === "string" && args.subagent_type.length > 0
        ? args.subagent_type
        : typeof args.category === "string" && args.category.length > 0
          ? args.category
          : "";
    if (requestedAgent) {
      storeInstructions.push({ type: "setLastTaskCategory", value: requestedAgent });
      storeInstructions.push({
        type: "setLastDispatch",
        route: input.decisionPrimary,
        subagent: requestedAgent,
      });
    }

    if (typeof args.prompt === "string") {
      const tail = `\n\n[oh-my-Aegis auto-dispatch] ${dispatch.reason}`;
      if (!args.prompt.includes("[oh-my-Aegis auto-dispatch]")) {
        args.prompt = `${args.prompt}${tail}`;
      }
    }
  }

  if (!input.config.auto_dispatch.enabled && routePinned) {
    if ((userCategory || userSubagent) && (userSubagent !== input.decisionPrimary || userCategory)) {
      notes.push({
        key: "task.pin",
        message: `policy-pin task: route=${input.decisionPrimary} mode=${input.state.mode} scopeConfirmed=${input.state.scopeConfirmed} user_category=${userCategory || "(none)"} user_subagent=${userSubagent || "(none)"}`,
      });
    }
    args.subagent_type = input.decisionPrimary;
    if ("category" in args) {
      delete args.category;
    }
    storeInstructions.push({ type: "setLastTaskCategory", value: input.decisionPrimary });
    storeInstructions.push({
      type: "setLastDispatch",
      route: input.decisionPrimary,
      subagent: input.decisionPrimary,
    });
  }

  if (typeof args.prompt === "string" && !hasPlaybookMarker(args.prompt)) {
    args.prompt = `${args.prompt}\n\n${buildTaskPlaybook(input.state, input.config)}`;
  }

  const categoryRequested = typeof args.category === "string" ? args.category.trim() : "";
  const subagentRequested = typeof args.subagent_type === "string" ? args.subagent_type.trim() : "";
  if (!subagentRequested && categoryRequested) {
    args.subagent_type = categoryRequested;
    if ("category" in args) {
      delete args.category;
    }
  }

  const THINKING_MODEL_ID = input.config.dynamic_model.thinking_model;
  const rawRequested = typeof args.subagent_type === "string" ? args.subagent_type.trim() : "";
  const requested = baseAgentName(rawRequested);
  if (requested && rawRequested !== requested) {
    args.subagent_type = requested;
  }
  const thinkMode = input.state.thinkMode;
  const MAX_AUTO_DEEPEN_PER_SESSION = 3;
  const autoDeepenCount = input.state.recentEvents.filter((e) => e === "auto_deepen_applied").length;
  const shouldAutoDeepen =
    input.state.mode === "CTF" &&
    isStuck(input.state, input.config) &&
    autoDeepenCount < MAX_AUTO_DEEPEN_PER_SESSION;
  const shouldUltrathink = thinkMode === "ultrathink";
  const shouldThink =
    thinkMode === "think" &&
    (input.state.phase === "PLAN" || input.decisionPrimary === "ctf-hypothesis" || input.decisionPrimary === "deep-plan");

  const userPreferredModel = typeof args.model === "string" ? args.model.trim() : "";
  const userPreferredVariant = typeof args.variant === "string" ? args.variant.trim() : "";

  let preferredModel = dispatchModel;
  let preferredVariant = "";
  let thinkProfileApplied = false;
  if (requested && (shouldUltrathink || shouldThink || shouldAutoDeepen)) {
    if (
      !isNonOverridableSubagent(requested) &&
      isModelHealthy(input.state, THINKING_MODEL_ID, input.config.dynamic_model.health_cooldown_ms)
    ) {
      preferredModel = THINKING_MODEL_ID;
      preferredVariant = "xhigh";
      thinkProfileApplied = true;
      if (shouldAutoDeepen) {
        storeInstructions.push({
          type: "appendRecentEvent",
          value: "auto_deepen_applied",
          cap: 30,
        });
      }
      notes.push({
        key: "thinkmode.apply",
        message: `Think mode profile applied: subagent=${requested}, model=${THINKING_MODEL_ID}, variant=${preferredVariant} (mode=${thinkMode} stuck=${shouldAutoDeepen} deepenCount=${autoDeepenCount})`,
      });
    } else {
      notes.push({
        key: "thinkmode.skip",
        message: `Think mode skipped: pro model unhealthy or non-overridable. Keeping '${requested}'. (mode=${thinkMode} stuck=${shouldAutoDeepen})`,
      });
    }
  }

  if (requested) {
    const profileMap = input.state.subagentProfileOverrides;
    const overrideProfile = profileMap[requested] ?? profileMap[rawRequested] ?? null;

    if (overrideProfile) {
      const overrideModel =
        typeof overrideProfile.model === "string" ? overrideProfile.model.trim() : "";
      const overrideVariant =
        typeof overrideProfile.variant === "string" ? overrideProfile.variant.trim() : "";
      if (overrideModel) {
        preferredModel = overrideModel;
      }
      if (overrideVariant) {
        preferredVariant = overrideVariant;
      }
      if (overrideModel || overrideVariant) {
        notes.push({
          key: "subagent.profile.override",
          message: `Subagent profile override applied: subagent=${requested}, model=${overrideModel || "(unchanged)"}, variant=${overrideVariant || "(unchanged)"}`,
        });
      }
    }

    if (userPreferredModel) {
      preferredModel = userPreferredModel;
    }
    if (userPreferredVariant) {
      preferredVariant = userPreferredVariant;
    }

    const resolvedProfile = resolveAgentExecutionProfile(rawRequested || requested, {
      preferredModel,
      preferredVariant,
      roleProfiles: input.config.dynamic_model.role_profiles,
      agentModelOverrides: input.config.dynamic_model.agent_model_overrides,
    });
    args.subagent_type = resolvedProfile.baseAgent;
    args.model = resolvedProfile.model;
    args.variant = resolvedProfile.variant;
    storeInstructions.push({
      type: "setLastTaskCategory",
      value: resolvedProfile.baseAgent,
    });
    storeInstructions.push({
      type: "setLastDispatch",
      route: input.decisionPrimary,
      subagent: resolvedProfile.baseAgent,
      model: resolvedProfile.model,
      variant: resolvedProfile.variant,
    });

    if (thinkProfileApplied) {
      notes.push({
        key: "thinkmode.resolved",
        message: `Think mode resolved profile: subagent=${resolvedProfile.baseAgent}, model=${resolvedProfile.model}, variant=${resolvedProfile.variant}`,
      });
    }
  }

  const finalSubagent =
    typeof args.subagent_type === "string" ? baseAgentName(args.subagent_type.trim()) : "";
  const verificationRoutes = new Set(["ctf-verify", "ctf-decoy-check"]);
  const envParityRequiredTargets = new Set<TargetType>(["PWN", "REV"]);
  if (input.state.mode === "CTF" && verificationRoutes.has(finalSubagent)) {
    if (input.state.phase !== "VERIFY") {
      throw new Error(
        "Verification route is blocked until candidate review reaches VERIFY phase. Move through SCAN -> PLAN -> EXECUTE -> VERIFY first."
      );
    }
    if (!input.state.candidatePendingVerification || input.state.latestCandidate.trim().length === 0) {
      throw new Error(
        "Verification route is blocked because no active candidate is pending verification."
      );
    }
    if (envParityRequiredTargets.has(input.state.targetType)) {
      if (!input.state.envParityChecked) {
        throw new Error(
          "PWN/REV verification route is blocked until env parity baseline is checked. Run `ctf_env_parity` first."
        );
      }
      if (!input.state.envParityAllMatch) {
        throw new Error(
          "PWN/REV verification route is blocked because env parity mismatch was detected. Re-align environment before verification."
        );
      }
    }
  }
  if (
    input.state.mode === "CTF" &&
    finalSubagent === "ctf-verify" &&
    input.state.latestCandidate.trim().length > 0 &&
    isLowConfidenceCandidate(input.state.latestCandidate)
  ) {
    throw new Error(
      "Direct ctf-verify is blocked for low-confidence or decoy-like candidate. Run ctf-decoy-check and gather stronger evidence first."
    );
  }

  if (typeof args.prompt === "string" && finalSubagent) {
    let promptText = args.prompt;
    const sharedPrompt = input.resolveSharedChannelPrompt(finalSubagent);
    if (sharedPrompt && !promptText.includes("[oh-my-Aegis shared-channel]")) {
      promptText = `${promptText}\n\n${sharedPrompt}`;
    }
    if (!promptText.includes("[oh-my-Aegis todo-lock]")) {
      promptText = [
        promptText,
        "",
        "[oh-my-Aegis todo-lock]",
        "- Do NOT replace or skip the current in_progress TODO until you explicitly mark it completed or cancelled with a blocked/failed note.",
        "- If blocked, keep the current task visible and add a follow-up TODO instead of silently switching focus.",
        "- When you find reusable progress for other agents, publish it via ctf_orch_channel_publish.",
      ].join("\n");
    }
    if (input.isWindows && !promptText.includes("[oh-my-Aegis windows-fallback]")) {
      promptText = [
        promptText,
        "",
        "[oh-my-Aegis windows-fallback]",
        "- If a GUI tool is blocked or unavailable, call ctf_orch_windows_cli_fallback immediately.",
        "- Prefer CLI-capable replacements first; if missing, generate/install via winget/choco/powershell and continue after confirming availability.",
      ].join("\n");
    }
    args.prompt = promptText;
  }

  if (input.state.thinkMode !== "none") {
    storeInstructions.push({ type: "setThinkMode", value: "none" });
  }

  if (input.config.skill_autoload.enabled) {
    const subagentType = typeof args.subagent_type === "string" ? args.subagent_type : input.decisionPrimary;
    const autoload = resolveAutoloadSkills({
      state: input.state,
      config: input.config,
      subagentType,
      availableSkills: input.availableSkills,
    });
    const merged = mergeLoadSkills({
      existing: args.load_skills,
      autoload,
      maxSkills: input.config.skill_autoload.max_skills,
      availableSkills: input.availableSkills,
    });
    if (merged.length > 0) {
      args.load_skills = merged;
    }
  }

  return {
    args,
    notes,
    storeInstructions,
    clearSearchModeGuidancePending,
  };
}
