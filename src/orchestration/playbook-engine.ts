import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import { loadPlaybookRegistry, type PlaybookRegistry, type PlaybookRule } from "./playbook-loader";

export type PlaybookContext = {
  mode: string;
  targetType: string;
  decoySuspect: boolean;
  interactiveEnabled: boolean;
  sequentialThinkingActive: boolean;
  sequentialThinkingToolName: string;
  contradictionPatchDumpDone: boolean;
  staleToolPatternLoops: number;
  noNewEvidenceLoops: number;
  contradictionPivotDebt: number;
};

export type PlaybookNextAction = {
  ruleId: string;
  tool?: string;
  route?: string;
};

function evaluateStateCondition(context: PlaybookContext, field: string, equals: string | number | boolean): boolean {
  const value = (context as Record<string, unknown>)[field];
  return value === equals;
}

function evaluateCounterCondition(
  context: PlaybookContext,
  field: string,
  comparator: { gt?: number; gte?: number; lt?: number; lte?: number }
): boolean {
  const raw = (context as Record<string, unknown>)[field];
  if (typeof raw !== "number") {
    return false;
  }
  if (comparator.gt !== undefined && !(raw > comparator.gt)) {
    return false;
  }
  if (comparator.gte !== undefined && !(raw >= comparator.gte)) {
    return false;
  }
  if (comparator.lt !== undefined && !(raw < comparator.lt)) {
    return false;
  }
  if (comparator.lte !== undefined && !(raw <= comparator.lte)) {
    return false;
  }
  return true;
}

export function matchesPlaybookRule(rule: PlaybookRule, context: PlaybookContext): boolean {
  const { pattern, states, counters } = rule.trigger;
  if (pattern?.modes && !pattern.modes.includes(context.mode)) {
    return false;
  }
  if (pattern?.targets && !pattern.targets.includes(context.targetType)) {
    return false;
  }
  for (const condition of states) {
    if (!evaluateStateCondition(context, condition.field, condition.equals)) {
      return false;
    }
  }
  for (const condition of counters) {
    if (!evaluateCounterCondition(context, condition.field, condition)) {
      return false;
    }
  }
  return true;
}

export function renderPlaybookTemplate(text: string, context: PlaybookContext): string {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = (context as Record<string, unknown>)[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function isStuckForPlaybook(state: SessionState, config: OrchestratorConfig): boolean {
  const now = Date.now();
  if (now - state.oracleProgressImprovedAt <= 10 * 60 * 1000) {
    return false;
  }
  const threshold = config.stuck_threshold;
  return (
    state.noNewEvidenceLoops >= threshold ||
    state.samePayloadLoops >= threshold ||
    state.verifyFailCount >= threshold
  );
}

function isSequentialThinkingActive(state: SessionState, config: OrchestratorConfig): boolean {
  if (!config.sequential_thinking.enabled) {
    return false;
  }
  const targetOk = config.sequential_thinking.activate_targets.includes(state.targetType);
  const phaseOk = config.sequential_thinking.activate_phases.includes(state.phase);
  const stuckOk = config.sequential_thinking.activate_on_stuck && isStuckForPlaybook(state, config);
  const thinkingOk = !config.sequential_thinking.disable_with_thinking_model || state.thinkMode === "none";
  return thinkingOk && ((targetOk && phaseOk) || stuckOk);
}

export function buildPlaybookContext(state: SessionState, config: OrchestratorConfig): PlaybookContext {
  const interactiveEnabled = config.interactive.enabled || config.interactive.enabled_in_ctf;
  return {
    mode: state.mode,
    targetType: state.targetType,
    decoySuspect: state.decoySuspect,
    interactiveEnabled,
    sequentialThinkingActive: isSequentialThinkingActive(state, config),
    sequentialThinkingToolName: config.sequential_thinking.tool_name,
    contradictionPatchDumpDone: state.contradictionPatchDumpDone,
    staleToolPatternLoops: state.staleToolPatternLoops,
    noNewEvidenceLoops: state.noNewEvidenceLoops,
    contradictionPivotDebt: state.contradictionPivotDebt,
  };
}

export function findMatchingPlaybookRule(registry: PlaybookRegistry, context: PlaybookContext): PlaybookRule | null {
  for (const rule of registry.base_rules) {
    if (matchesPlaybookRule(rule, context)) {
      return rule;
    }
  }
  for (const rule of registry.conditional_rules) {
    if (matchesPlaybookRule(rule, context)) {
      return rule;
    }
  }
  return null;
}

function findMatchingConditionalRule(registry: PlaybookRegistry, context: PlaybookContext): PlaybookRule | null {
  for (const rule of registry.conditional_rules) {
    if (matchesPlaybookRule(rule, context)) {
      return rule;
    }
  }
  return null;
}

export function findPlaybookNextAction(state: SessionState, config: OrchestratorConfig): PlaybookNextAction | null {
  const registry = loadPlaybookRegistry();
  const context = buildPlaybookContext(state, config);
  const conditionalRule = findMatchingConditionalRule(registry, context);
  const rule = conditionalRule ?? findMatchingPlaybookRule(registry, context);
  if (!rule) {
    return null;
  }
  return {
    ruleId: rule.id,
    tool: rule.mandatory_next_action.tool,
    route: rule.mandatory_next_action.route,
  };
}

export function findPlaybookNextRouteAction(state: SessionState, config: OrchestratorConfig): PlaybookNextAction | null {
  const registry = loadPlaybookRegistry();
  const context = buildPlaybookContext(state, config);

  for (const rule of registry.conditional_rules) {
    if (matchesPlaybookRule(rule, context) && rule.mandatory_next_action.route) {
      return {
        ruleId: rule.id,
        tool: rule.mandatory_next_action.tool,
        route: rule.mandatory_next_action.route,
      };
    }
  }
  for (const rule of registry.base_rules) {
    if (matchesPlaybookRule(rule, context) && rule.mandatory_next_action.route) {
      return {
        ruleId: rule.id,
        tool: rule.mandatory_next_action.tool,
        route: rule.mandatory_next_action.route,
      };
    }
  }
  return null;
}
