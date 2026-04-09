import type { OrchestratorConfig } from "../config/schema";
import type { AegisGuidanceRole } from "../helpers/plugin-utils";
import {
  buildSignalGuidance,
  buildPhaseInstruction,
  buildDelegateBiasSection,
  buildHardBlocksSection,
  buildParallelRulesSection,
  buildProblemStateSection,
  buildRouteTransparencySection,
  buildAvailableSubagentsSection,
} from "../orchestration/signal-actions";
import { buildIntentGateSection } from "../orchestration/intent-gate";
import { buildToolGuide } from "../orchestration/tool-guide";
import { buildTaskPlaybook } from "../orchestration/playbook";
import type { RouteDecision } from "../types/route-decision";
import type { SessionState } from "../state/types";

/**
 * Build the system-prompt sections injected by the
 * `experimental.chat.system.transform` hook.
 *
 * Returns a single string ready to push onto `output.system`.
 */
export function buildSystemPromptSections(
  state: SessionState,
  config: OrchestratorConfig,
  decision: RouteDecision,
  availableSubagents: string[],
  role: AegisGuidanceRole = "worker",
): string {
  const systemLines: string[] = [
    `MODE: ${state.mode}`,
    `PHASE: ${state.phase}`,
    `TARGET: ${state.targetType}`,
    `ULTRAWORK: ${state.ultraworkEnabled ? "ENABLED" : "DISABLED"}`,
    "",
    // Issue 10: route transparency
    buildRouteTransparencySection(state, decision.primary, decision.reason),
    "",
    // Issue 1: Intent Gate (Phase 0)
    buildIntentGateSection(state),
    "",
  ];

  // Issue 6: Problem state
  const problemStateSection = buildProblemStateSection(state);
  if (problemStateSection) {
    systemLines.push(problemStateSection, "");
  }

  systemLines.push(buildPhaseInstruction(state, role), "");

  const signalGuidance = buildSignalGuidance(state, config, role);
  if (signalGuidance.length > 0) {
    systemLines.push(...signalGuidance, "");
  }

  systemLines.push(buildToolGuide(state, role), "");

  // Issue 2: dynamic available sub-agents
  const subagentsSection = buildAvailableSubagentsSection(state, availableSubagents);
  if (subagentsSection) {
    systemLines.push(subagentsSection, "");
  }

  // Issue 3: delegation bias
  systemLines.push(buildDelegateBiasSection(state), "");

  // Issue 5: parallel rules
  systemLines.push(buildParallelRulesSection(state, role), "");

  const playbook = buildTaskPlaybook(state, config);
  if (playbook) {
    systemLines.push(playbook, "");
  }

  // Issue 7: hard blocks
  systemLines.push(buildHardBlocksSection(), "");

  systemLines.push(
    `RULE: each loop must maintain plan + todo list (multiple todos allowed, one in_progress), then verify/log.`
  );
  if (state.ultraworkEnabled) {
    systemLines.push(`RULE: ultrawork enabled - do not stop without verified evidence.`);
  }

  return systemLines.join("\n");
}

/**
 * Collect the set of available subagent names from the routing config for the
 * current session mode.
 */
export function collectAvailableSubagents(
  state: SessionState,
  config: OrchestratorConfig,
): string[] {
  const modeRouting = state.mode === "CTF" ? config.routing.ctf : config.routing.bounty;
  const subagentSet = new Set<string>();
  for (const phaseMap of Object.values(modeRouting)) {
    for (const routeName of Object.values(phaseMap as Record<string, string>)) {
      if (typeof routeName === "string" && routeName) {
        subagentSet.add(routeName);
      }
    }
  }
  return [...subagentSet].sort();
}
