import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";

export interface CompactingContext {
  state: SessionState;
  config: OrchestratorConfig;
  notesRootDir: string;
}

/**
 * Pure logic for the `experimental.session.compacting` hook.
 *
 * Returns an array of context strings to push onto `output.context`.
 */
export function buildCompactingContext(ctx: CompactingContext): string[] {
  const lines: string[] = [];

  lines.push(
    `orchestrator-state: mode=${ctx.state.mode}, phase=${ctx.state.phase}, target=${ctx.state.targetType}, verifyFailCount=${ctx.state.verifyFailCount}`
  );
  lines.push(
    `markdown-budgets: WORKLOG ${ctx.config.markdown_budget.worklog_lines} lines/${ctx.config.markdown_budget.worklog_bytes} bytes; EVIDENCE ${ctx.config.markdown_budget.evidence_lines}/${ctx.config.markdown_budget.evidence_bytes}`
  );

  const contextPackPath = join(ctx.notesRootDir, "CONTEXT_PACK.md");
  if (existsSync(contextPackPath)) {
    const text = readFileSync(contextPackPath, "utf-8").trim();
    if (text) {
      lines.push(`durable-context:\n${text.slice(0, 16_000)}`);
    }
  }

  const planPath = join(ctx.notesRootDir, "PLAN.md");
  if (existsSync(planPath)) {
    const text = readFileSync(planPath, "utf-8").trim();
    if (text) {
      lines.push(`durable-plan:\n${text.slice(0, 12_000)}`);
    }
  }

  return lines;
}
