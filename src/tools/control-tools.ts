import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
import { buildReadinessReport } from "../config/readiness";
import { resolveFailoverAgent, route } from "../orchestration/router";
import type { NotesStore } from "../state/notes-store";
import { type SessionStore } from "../state/session-store";
import { type FailureReason, type SessionEvent, type TargetType } from "../state/types";

const schema = tool.schema;
const FAILURE_REASON_VALUES: FailureReason[] = [
  "verification_mismatch",
  "tooling_timeout",
  "context_overflow",
  "hypothesis_stall",
  "exploit_chain",
  "environment",
];

export function createControlTools(
  store: SessionStore,
  notesStore: NotesStore,
  config: OrchestratorConfig,
  projectDir: string
): Record<string, ToolDefinition> {
  return {
    ctf_orch_status: tool({
      description: "Get current CTF/BOUNTY orchestration state and route decision",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        const decision = route(state, config);
        return JSON.stringify({ sessionID, state, decision }, null, 2);
      },
    }),

    ctf_orch_set_mode: tool({
      description: "Set orchestrator mode (CTF or BOUNTY) for this session",
      args: {
        mode: schema.enum(["CTF", "BOUNTY"]),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.setMode(sessionID, args.mode);
        return JSON.stringify({ sessionID, mode: state.mode }, null, 2);
      },
    }),

    ctf_orch_set_ultrawork: tool({
      description: "Enable or disable ultrawork mode (continuous execution posture) for this session",
      args: {
        enabled: schema.boolean(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        store.setUltraworkEnabled(sessionID, args.enabled);
        const state = store.setAutoLoopEnabled(sessionID, args.enabled);
        return JSON.stringify(
          {
            sessionID,
            ultraworkEnabled: state.ultraworkEnabled,
            autoLoopEnabled: state.autoLoopEnabled,
          },
          null,
          2
        );
      },
    }),

    ctf_orch_set_autoloop: tool({
      description: "Enable or disable automatic loop continuation for this session",
      args: {
        enabled: schema.boolean(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.setAutoLoopEnabled(sessionID, args.enabled);
        return JSON.stringify(
          {
            sessionID,
            autoLoopEnabled: state.autoLoopEnabled,
            autoLoopIterations: state.autoLoopIterations,
          },
          null,
          2
        );
      },
    }),

    ctf_orch_event: tool({
      description: "Apply an orchestration state event (scan/plan/verify/stuck tracking)",
      args: {
        event: schema.enum([
          "scan_completed",
          "plan_completed",
          "candidate_found",
          "verify_success",
          "verify_fail",
          "no_new_evidence",
          "same_payload_repeat",
          "new_evidence",
          "readonly_inconclusive",
          "scope_confirmed",
          "context_length_exceeded",
          "timeout",
          "reset_loop",
        ]),
        session_id: schema.string().optional(),
        candidate: schema.string().optional(),
        verified: schema.string().optional(),
        hypothesis: schema.string().optional(),
        alternatives: schema.array(schema.string()).optional(),
        failure_reason: schema
          .enum([
            "verification_mismatch",
            "tooling_timeout",
            "context_overflow",
            "hypothesis_stall",
            "exploit_chain",
            "environment",
          ])
          .optional(),
        failed_route: schema.string().optional(),
        failure_summary: schema.string().optional(),
        target_type: schema
          .enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"])
          .optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (args.hypothesis) {
          store.setHypothesis(sessionID, args.hypothesis);
        }
        if (args.alternatives) {
          store.setAlternatives(sessionID, args.alternatives);
        }
        if (args.target_type) {
          store.setTargetType(sessionID, args.target_type as TargetType);
        }
        if (args.event === "candidate_found" && args.candidate) {
          store.setCandidate(sessionID, args.candidate);
        }
        if (args.event === "verify_success" && args.verified) {
          store.setVerified(sessionID, args.verified);
        }
        if (args.failure_reason) {
          store.recordFailure(sessionID, args.failure_reason as FailureReason, args.failed_route ?? "", args.failure_summary ?? "");
        }
        const state = store.applyEvent(sessionID, args.event as SessionEvent);
        return JSON.stringify({ sessionID, state, decision: route(state, config) }, null, 2);
      },
    }),

    ctf_orch_next: tool({
      description: "Return the current recommended next category/agent route",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        return JSON.stringify({ sessionID, decision: route(state, config) }, null, 2);
      },
    }),


    ctf_orch_postmortem: tool({
      description: "Summarize failure reasons and suggest next adaptive route",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        const decision = route(state, config);
        const topReasons = FAILURE_REASON_VALUES.map((reason) => ({
          reason,
          count: state.failureReasonCounts[reason],
        }))
          .filter((item) => item.count > 0)
          .sort((a, b) => b.count - a.count);

        const recommendation =
          state.lastFailureReason === "verification_mismatch"
            ? state.verifyFailCount >= (config.stuck_threshold ?? 2)
              ? "Repeated verification mismatch: treat as decoy/constraint mismatch and pivot via stuck route."
              : "Route through ctf-decoy-check then ctf-verify for candidate validation."
            : state.lastFailureReason === "tooling_timeout" || state.lastFailureReason === "context_overflow"
              ? "Use failover/compaction path and reduce output/context size before retry."
              : state.lastFailureReason === "hypothesis_stall"
                ? "Pivot hypothesis immediately and run cheapest disconfirm test next."
                : state.lastFailureReason === "exploit_chain"
                  ? "Stabilize exploit chain with deterministic repro artifacts before rerun."
                  : state.lastFailureReason === "environment"
                    ? "Fix runtime environment/tool availability before continuing exploitation."
                    : "No recent classified failure reason; continue normal route.";

        return JSON.stringify(
          {
            sessionID,
            lastFailureReason: state.lastFailureReason,
            lastFailureSummary: state.lastFailureSummary,
            lastFailedRoute: state.lastFailedRoute,
            lastFailureAt: state.lastFailureAt,
            topReasons,
            recommendation,
            nextDecision: decision,
          },
          null,
          2
        );
      },
    }),

    ctf_orch_failover: tool({
      description: "Resolve fallback agent name from original agent + error text",
      args: {
        agent: schema.string(),
        error: schema.string(),
      },
      execute: async (args) => {
        const fallback = resolveFailoverAgent(args.agent, args.error, config.failover);
        return JSON.stringify({ original: args.agent, fallback: fallback ?? "NONE" }, null, 2);
      },
    }),

    ctf_orch_check_budgets: tool({
      description: "Check markdown budget overflows in runtime notes",
      args: {},
      execute: async () => {
        const issues = notesStore.checkBudgets();
        return JSON.stringify({ ok: issues.length === 0, issues }, null, 2);
      },
    }),

    ctf_orch_compact: tool({
      description: "Compact/rotate markdown notes that exceed budget limits",
      args: {},
      execute: async () => {
        const actions = notesStore.compactNow();
        return JSON.stringify({ actions }, null, 2);
      },
    }),

    ctf_orch_readiness: tool({
      description: "Check subagent/MCP mappings and notes writability readiness",
      args: {},
      execute: async () => {
        const report = buildReadinessReport(projectDir, notesStore, config);
        return JSON.stringify(report, null, 2);
      },
    }),
  };
}
