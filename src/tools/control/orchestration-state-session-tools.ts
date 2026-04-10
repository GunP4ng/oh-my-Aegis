import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../../config/schema";
import { buildReadinessReport } from "../../config/readiness";
import { resolveFailoverAgent, route } from "../../orchestration/router";
import {
  extractSessionClient,
} from "../../orchestration/parallel";
import { getExploitTemplate, listExploitTemplates } from "../../orchestration/exploit-templates";
import { triageFile } from "../../orchestration/auto-triage";
import { runGeminiCli } from "../../orchestration/gemini-cli";
import { runClaudeCodeCli } from "../../orchestration/claude-code-cli";
import { buildWindowsCliFallbackPlan } from "../../orchestration/windows-cli-fallback";
import { appendEvidenceLedger, scoreEvidence, type EvidenceEntry, type EvidenceType } from "../../orchestration/evidence-ledger";
import {
  isVariantSupportedForModel,
  providerIdFromModel,
  supportedVariantsForModel,
} from "../../orchestration/model-health";
import { hasAcceptanceEvidence, isLowConfidenceCandidate } from "../../risk/sanitize";
import type { NotesStore } from "../../state/notes-store";
import { type SessionStore } from "../../state/session-store";
import { normalizeSessionID } from "../../state/session-id";
import { type FailureReason, type SessionEvent, type TargetType } from "../../state/types";
import { appendJsonlRecord } from "../../orchestration/jsonl-sink";
import { callConfigProviders as callConfigProvidersCompat, callSessionPromptAsync } from "../../orchestration/opencode-client-compat";
import { safeJsonParse } from "../../utils/json";
import { isRecord } from "../../utils/is-record";
import { hasErrorResponse } from "../../utils/sdk-response";
import {
  validateEventPhaseTransition,
  normalizeSubagentType,
  isValidModelID,
  isValidVariantID,
  modelIdFromModel,
} from "./helpers";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const schema = tool.schema;

const FAILURE_REASON_VALUES: FailureReason[] = [
  "verification_mismatch",
  "tooling_timeout",
  "context_overflow",
  "input_validation_non_retryable",
  "hypothesis_stall",
  "unsat_claim",
  "static_dynamic_contradiction",
  "exploit_chain",
  "environment",
];

/* ------------------------------------------------------------------ */
/*  Deps interface                                                    */
/* ------------------------------------------------------------------ */

export interface OrchestrationToolDeps {
  store: SessionStore;
  notesStore: NotesStore;
  config: OrchestratorConfig;
  projectDir: string;
  client: unknown;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                  */
/* ------------------------------------------------------------------ */

function extractAgentModels(opencodePath: string | null): string[] {
  if (!opencodePath) return [];
  let parsed: unknown;
  try {
    parsed = safeJsonParse(readFileSync(opencodePath, "utf-8"));
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const agentCandidate = isRecord(parsed.agent) ? parsed.agent : isRecord(parsed.agents) ? parsed.agents : null;
  if (!agentCandidate) return [];
  const models: string[] = [];
  for (const value of Object.values(agentCandidate)) {
    if (!isRecord(value)) continue;
    const m = value.model;
    if (typeof m === "string" && m.trim().length > 0) {
      models.push(m.trim());
    }
  }
  return [...new Set(models)];
}

function buildToolProposalContext(projectDir: string, sessionID: string): {
  sandbox_cwd: string;
  run_id: string;
  manifest_ref: string;
  patch_diff_ref: string;
} {
  const normalizedSessionID = normalizeSessionID(sessionID);
  const runID = `tool-${normalizedSessionID}-${randomUUID()}`;
  const runRoot = join(projectDir, ".Aegis", "runs", runID);
  const sandboxCwd = resolve(join(runRoot, "sandbox"));
  mkdirSync(sandboxCwd, { recursive: true });
  return {
    sandbox_cwd: sandboxCwd,
    run_id: runID,
    manifest_ref: `.Aegis/runs/${runID}/run-manifest.json`,
    patch_diff_ref: `.Aegis/runs/${runID}/patches/proposal.diff`,
  };
}

function createExtractSessionApi(client: unknown): () => Record<string, unknown> | null {
  return (): Record<string, unknown> | null => {
    const session = (client as { session?: unknown } | null)?.session as unknown;
    if (!session || typeof session !== "object") return null;
    return session as Record<string, unknown>;
  };
}

function createCallPrimaryThenFallback() {
  return async <T>(params: {
    fn: (args: unknown) => Promise<unknown>;
    primaryArgs: unknown;
    fallbackArgs: unknown;
    extractData: (result: unknown) => T | null;
    unexpectedReason: string;
  }): Promise<{ ok: true; data: T } | { ok: false; reason: string }> => {
    try {
      const primary = await params.fn(params.primaryArgs);
      const data = params.extractData(primary);
      if (data !== null) {
        return { ok: true as const, data };
      }
    } catch (error) {
      void error;
    }

    try {
      const fallback = await params.fn(params.fallbackArgs);
      const data = params.extractData(fallback);
      if (data !== null) {
        return { ok: true as const, data };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
    return { ok: false as const, reason: params.unexpectedReason };
  };
}

function createCallSessionList(
  client: unknown,
  projectDir: string,
  extractSessionApi: () => Record<string, unknown> | null,
  callPrimaryThenFallback: ReturnType<typeof createCallPrimaryThenFallback>,
) {
  const hasError = hasErrorResponse;
  return async (directory: string, limit: number | undefined) => {
    const sessionApi = extractSessionApi();
    const listFn = (sessionApi as { list?: unknown } | null)?.list;
    if (typeof listFn === "function") {
      const listed = await callPrimaryThenFallback<unknown[]>({
        fn: listFn as (args: unknown) => Promise<unknown>,
        primaryArgs: { query: { directory, limit } },
        fallbackArgs: { directory, limit },
        extractData: (result) => {
          const candidate = isRecord(result) ? (result as Record<string, unknown>).data : null;
          return Array.isArray(candidate) ? (candidate as unknown[]) : null;
        },
        unexpectedReason: "unexpected session.list response",
      });
      if (listed.ok) {
        return { ok: true as const, data: listed.data };
      }
    }

    const sessionClient = extractSessionClient(client);
    if (!sessionClient) {
      return { ok: false as const, reason: "SDK session client not available" };
    }
    try {
      const statusMap = await sessionClient.status({ query: { directory } });
      const map = isRecord(statusMap?.data) ? (statusMap.data as Record<string, unknown>) : isRecord(statusMap) ? statusMap : {};
      const ids = Object.keys(map);
      const sliced = typeof limit === "number" && limit > 0 ? ids.slice(0, limit) : ids;
      const synthesized = sliced.map((id) => {
        const item = map[id];
        const status = isRecord(item) && typeof item.type === "string" ? item.type : undefined;
        return { id, status };
      });
      return { ok: true as const, data: synthesized };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };
}

function createCallSessionMessages(
  client: unknown,
  callPrimaryThenFallback: ReturnType<typeof createCallPrimaryThenFallback>,
) {
  const hasError = hasErrorResponse;
  return async (directory: string, sessionID: string, limit: number) => {
    const sessionClient = extractSessionClient(client);
    if (!sessionClient) {
      return { ok: false as const, reason: "SDK session client not available" };
    }
    const res = await callPrimaryThenFallback<unknown[]>({
      fn: sessionClient.messages as unknown as (args: unknown) => Promise<unknown>,
      primaryArgs: { path: { id: sessionID }, query: { directory, limit } },
      fallbackArgs: { sessionID, directory, limit },
      extractData: (result) => {
        if (hasError(result) || !isRecord(result)) return null;
        const data = (result as Record<string, unknown>).data;
        return Array.isArray(data) ? (data as unknown[]) : null;
      },
      unexpectedReason: "unexpected session.messages response",
    });
    return res.ok ? { ok: true as const, data: res.data } : { ok: false as const, reason: res.reason };
  };
}

function createMetricsHelpers(notesStore: NotesStore) {
  const metricsPath = (): string => join(notesStore.getRootDirectory(), "metrics.jsonl");
  const legacyMetricsPath = (): string => join(notesStore.getRootDirectory(), "metrics.json");

  const appendMetric = (entry: Record<string, unknown>): { ok: true } | { ok: false; reason: string } => {
    try {
      const path = metricsPath();
      appendJsonlRecord(path, entry);
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const buildMetricEntry = (
    sessionID: string,
    eventName: string,
    correlationId: string,
    state: ReturnType<SessionStore["get"]>,
    extras: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    at: new Date().toISOString(),
    sessionID,
    source: "ctf_orch_event",
    correlationId,
    event: eventName,
    mode: state.mode,
    phase: state.phase,
    targetType: state.targetType,
    route: state.lastTaskRoute || state.lastTaskCategory,
    subagent: state.lastTaskSubagent,
    model: state.lastTaskModel,
    variant: state.lastTaskVariant,
    candidate: state.latestCandidate,
    verified: state.latestVerified,
    failureReason: state.lastFailureReason,
    failedRoute: state.lastFailedRoute,
    failureSummary: state.lastFailureSummary,
    contradictionPivotDebt: state.contradictionPivotDebt,
    contradictionPatchDumpDone: state.contradictionPatchDumpDone,
    contradictionArtifactLockActive: state.contradictionArtifactLockActive,
    contradictionArtifacts: state.contradictionArtifacts,
    envParityChecked: state.envParityChecked,
    envParityAllMatch: state.envParityAllMatch,
    envParityRequired: state.envParityRequired,
    envParityRequirementReason: state.envParityRequirementReason,
    verifyFailCount: state.verifyFailCount,
    noNewEvidenceLoops: state.noNewEvidenceLoops,
    samePayloadLoops: state.samePayloadLoops,
    timeoutFailCount: state.timeoutFailCount,
    contextFailCount: state.contextFailCount,
    taskFailoverCount: state.taskFailoverCount,
    ...extras,
  });

  return { metricsPath, legacyMetricsPath, appendMetric, buildMetricEntry };
}

function createCallConfigProviders(client: unknown) {
  return async (directory: string) => {
    return callConfigProvidersCompat(client, directory);
  };
}

function createCallPromptAsync(client: unknown) {
  return async (sessionID: string, text: string, metadata: Record<string, unknown>) => {
    return callSessionPromptAsync(client, [{
      path: { id: sessionID },
      body: {
        parts: [
          {
            type: "text",
            text,
            synthetic: true,
            metadata,
          },
        ],
      },
    }]);
  };
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function createOrchestrationStateSessionTools(deps: OrchestrationToolDeps): Record<string, ToolDefinition> {
  const { store, notesStore, config, projectDir, client } = deps;

  const extractSessionApi = createExtractSessionApi(client);
  const callPrimaryThenFallback = createCallPrimaryThenFallback();
  const callSessionList = createCallSessionList(client, projectDir, extractSessionApi, callPrimaryThenFallback);
  const callSessionMessages = createCallSessionMessages(client, callPrimaryThenFallback);
  const { metricsPath, legacyMetricsPath, appendMetric, buildMetricEntry } = createMetricsHelpers(notesStore);
  const callConfigProviders = createCallConfigProviders(client);
  const callPromptAsync = createCallPromptAsync(client);

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
        return JSON.stringify({ sessionID, state, mode_explicit: state.modeExplicit, decision }, null, 2);
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
        return JSON.stringify({ sessionID, mode: state.mode, mode_explicit: state.modeExplicit }, null, 2);
      },
    }),

    ctf_orch_set_subagent_profile: tool({
      description: "Set model/variant override for a subagent in this session",
      args: {
        subagent_type: schema.string().min(1),
        model: schema.string().min(3),
        variant: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const subagentType = normalizeSubagentType(args.subagent_type);
        const model = args.model.trim();
        const variant = typeof args.variant === "string" ? args.variant.trim() : "";

        if (!subagentType) {
          return JSON.stringify({ ok: false, reason: "invalid subagent_type", sessionID }, null, 2);
        }
        if (!isValidModelID(model)) {
          return JSON.stringify(
            {
              ok: false,
              reason: "model must be in provider/model format",
              sessionID,
              subagent_type: subagentType,
            },
            null,
            2
          );
        }
        if (variant.length > 0 && !isValidVariantID(variant)) {
          return JSON.stringify(
            {
              ok: false,
              reason: "variant contains invalid characters",
              sessionID,
              subagent_type: subagentType,
            },
            null,
            2
          );
        }
        const supported = supportedVariantsForModel(model);
        if (supported.length > 0 && variant.length === 0) {
          return JSON.stringify(
            {
              ok: false,
              reason: "variant is required for model",
              sessionID,
              subagent_type: subagentType,
              model,
              supported_variants: supported,
            },
            null,
            2
          );
        }
        if (!isVariantSupportedForModel(model, variant)) {
          return JSON.stringify(
            {
              ok: false,
              reason: "variant not supported for model",
              sessionID,
              subagent_type: subagentType,
              model,
              variant,
              supported_variants: supported,
            },
            null,
            2
          );
        }

        const state = store.setSubagentProfileOverride(sessionID, subagentType, {
          model,
          variant,
        });

        return JSON.stringify(
          {
            ok: true,
            sessionID,
            subagent_type: subagentType,
            profile: state.subagentProfileOverrides[subagentType] ?? null,
            overrides: state.subagentProfileOverrides,
          },
          null,
          2
        );
      },
    }),

    ctf_orch_clear_subagent_profile: tool({
      description: "Clear one (or all) session subagent model/variant overrides",
      args: {
        subagent_type: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const hasSubagent =
          typeof args.subagent_type === "string" && args.subagent_type.trim().length > 0;
        const subagentType = hasSubagent ? normalizeSubagentType(args.subagent_type as string) : undefined;
        const state = store.clearSubagentProfileOverride(sessionID, subagentType);
        return JSON.stringify(
          {
            ok: true,
            sessionID,
            cleared: subagentType ?? "all",
            overrides: state.subagentProfileOverrides,
          },
          null,
          2
        );
      },
    }),

    ctf_orch_list_subagent_profiles: tool({
      description: "List current session subagent model/variant overrides",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const state = store.get(sessionID);
        return JSON.stringify(
          {
            ok: true,
            sessionID,
            overrides: state.subagentProfileOverrides,
          },
          null,
          2
        );
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

    ctf_orch_manual_verify: tool({
      description:
        "Manually record a successful verification with evidence and advance the session to SUBMIT phase. Use when you have verified the solution externally (e.g., running the checker command yourself).",
      args: {
        verification_command: schema.string(),
        stdout_summary: schema.string(),
        artifact_path: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        try {
          const state = store.setManualVerifySuccess(sessionID, {
            verificationCommand: args.verification_command,
            stdoutSummary: args.stdout_summary,
            artifactPath: args.artifact_path,
          });
          return JSON.stringify(
            {
              ok: true,
              sessionID,
              phase: state.phase,
              submissionPending: state.submissionPending,
              latestAcceptanceEvidence: state.latestAcceptanceEvidence,
            },
            null,
            2
          );
        } catch (err) {
          return JSON.stringify(
            {
              ok: false,
              sessionID,
              error: err instanceof Error ? err.message : String(err),
            },
            null,
            2
          );
        }
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
      description: "Apply an orchestration state event (scan/plan/verify/stuck tracking). Use intent_type to classify request intent (Phase 0 gate). Use problem_state to classify problem difficulty class.",
      args: {
        event: schema.enum([
          "scan_completed",
          "plan_completed",
          "candidate_found",
          "verify_success",
          "verify_fail",
          "submit_accepted",
          "submit_rejected",
          "no_new_evidence",
          "same_payload_repeat",
          "new_evidence",
          "readonly_inconclusive",
          "scope_confirmed",
          "context_length_exceeded",
          "timeout",
          "unsat_claim",
          "static_dynamic_contradiction",
          "reset_loop",
        ]),
        session_id: schema.string().optional(),
        candidate: schema.string().optional(),
        verified: schema.string().optional(),
        acceptance_evidence: schema.string().optional(),
        hypothesis: schema.string().optional(),
        alternatives: schema.array(schema.string()).optional(),
        failure_reason: schema
          .enum([
            "verification_mismatch",
            "tooling_timeout",
            "context_overflow",
            "input_validation_non_retryable",
            "hypothesis_stall",
            "unsat_claim",
            "static_dynamic_contradiction",
            "exploit_chain",
            "environment",
            ])
          .optional(),
        failed_route: schema.string().optional(),
        failure_summary: schema.string().optional(),
        target_type: schema
          .enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"])
          .optional(),
        artifact_paths: schema.array(schema.string()).optional(),
        correlation_id: schema.string().optional(),
        intent_type: schema.enum(["research", "implement", "investigate", "evaluate", "fix", "unknown"]).optional(),
        problem_state: schema.enum(["clean", "deceptive", "environment_sensitive", "evidence_poor", "unknown"]).optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const correlationId =
          typeof args.correlation_id === "string" && args.correlation_id.trim().length > 0
            ? args.correlation_id.trim()
            : randomUUID();
        const currentState = store.get(sessionID);
        const phaseTransitionError = validateEventPhaseTransition(
          args.event as SessionEvent,
          currentState.phase
        );
        if (phaseTransitionError) {
          return JSON.stringify(
            {
              ok: false,
              sessionID,
              event: args.event,
              phase: currentState.phase,
              reason: phaseTransitionError,
            },
            null,
            2,
          );
        }
        if (args.event === "verify_success" && (!args.verified || args.verified.trim().length === 0)) {
          return JSON.stringify(
            {
              ok: false,
              sessionID,
              reason: "verify_success requires non-empty verified evidence in args.verified",
            },
            null,
            2,
          );
        }
        if (args.event === "verify_success" && args.verified && isLowConfidenceCandidate(args.verified)) {
          return JSON.stringify(
            {
              ok: false,
              sessionID,
              reason: "verify_success rejected: low-confidence or placeholder verified payload",
            },
            null,
            2,
          );
        }
        if (args.event === "verify_success" && currentState.mode === "CTF") {
          return JSON.stringify(
            {
              ok: false,
              sessionID,
              reason:
                "manual verify_success is blocked in CTF. Use verifier output flow, then submit with acceptance evidence.",
            },
            null,
            2,
          );
        }
        if (args.event === "submit_accepted") {
          const acceptance = typeof args.acceptance_evidence === "string" ? args.acceptance_evidence.trim() : "";
          if (!args.verified || args.verified.trim().length === 0) {
            return JSON.stringify(
              {
                ok: false,
                sessionID,
                reason: "submit_accepted requires non-empty verified payload in args.verified",
              },
              null,
              2,
            );
          }
          if (acceptance.length === 0 || !hasAcceptanceEvidence(acceptance)) {
            return JSON.stringify(
              {
                ok: false,
                sessionID,
                reason:
                  "submit_accepted requires acceptance oracle evidence (Accepted/Correct/checker success) in args.acceptance_evidence",
              },
              null,
              2,
            );
          }
        }
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
        if (args.event === "submit_accepted" && args.verified) {
          store.setVerified(sessionID, args.verified);
        }
        if (args.event === "submit_accepted" && typeof args.acceptance_evidence === "string") {
          store.setAcceptanceEvidence(sessionID, args.acceptance_evidence);
        }
        if (args.failure_reason) {
          store.recordFailure(sessionID, args.failure_reason as FailureReason, args.failed_route ?? "", args.failure_summary ?? "");
        }
        let state = store.applyEvent(sessionID, args.event as SessionEvent);
        if (args.artifact_paths && args.artifact_paths.length > 0) {
          state = store.recordContradictionArtifacts(sessionID, args.artifact_paths);
        }
        if (args.intent_type) {
          store.setIntent(sessionID, args.intent_type);
        }
        if (args.problem_state) {
          store.setProblemStateClass(sessionID, args.problem_state);
        }
        if (
          args.event === "candidate_found" ||
          args.event === "verify_success" ||
          args.event === "verify_fail" ||
          args.event === "submit_accepted" ||
          args.event === "submit_rejected"
        ) {
          const evidenceType: EvidenceType =
            args.event === "submit_accepted"
              ? "acceptance_oracle"
              : args.event === "verify_success"
                ? "behavioral_runtime"
                : args.event === "verify_fail"
                  ? "dynamic_memory"
                  : "string_pattern";
          const summary =
            args.event === "submit_accepted"
              ? (typeof args.acceptance_evidence === "string" ? args.acceptance_evidence : "manual submit accepted")
              : typeof args.candidate === "string"
                ? args.candidate
                : String(args.event);
          const entry: EvidenceEntry = {
            at: new Date().toISOString(),
            sessionID,
            event: String(args.event),
            evidenceType,
            confidence: evidenceType === "acceptance_oracle" ? 1 : 0.8,
            summary: summary.replace(/\s+/g, " ").trim().slice(0, 240),
            source: "ctf_orch_event",
          };
          appendEvidenceLedger(notesStore.getRootDirectory(), entry);
          const scored = scoreEvidence([entry]);
          store.setCandidateLevel(sessionID, scored.level);
        }
        void appendMetric(
          buildMetricEntry(sessionID, String(args.event), correlationId, state, {
            eventFailureReason: args.failure_reason ?? null,
            eventFailedRoute: args.failed_route ?? null,
            eventFailureSummary: args.failure_summary ?? null,
            eventArtifactPaths: args.artifact_paths ?? [],
          })
        );
        const latestState = store.get(sessionID);
        return JSON.stringify({ sessionID, state: latestState, decision: route(latestState, config) }, null, 2);
      },
    }),

    ctf_orch_metrics: tool({
      description: "Read recorded CTF/BOUNTY metrics entries",
      args: {
        limit: schema.number().int().positive().max(500).default(100),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        try {
          const path = metricsPath();
          let entries: unknown[] = [];

          if (existsSync(path)) {
            const lines = readFileSync(path, "utf-8")
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            entries = lines
              .map((line) => {
                try {
                  return JSON.parse(line);
                } catch {
                  return null;
                }
              })
              .filter((item): item is unknown => item !== null)
              .slice(-args.limit);
          } else {
            const legPath = legacyMetricsPath();
            if (existsSync(legPath)) {
              const parsed = JSON.parse(readFileSync(legPath, "utf-8"));
              const arr = Array.isArray(parsed) ? parsed : [];
              entries = arr.slice(-args.limit);
            }
          }

          return JSON.stringify({ ok: true, sessionID, entries }, null, 2);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ ok: false, reason: message, sessionID }, null, 2);
        }
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

    ctf_orch_session_list: tool({
      description: "List OpenCode sessions (best-effort; falls back to status map if list API unavailable)",
      args: {
        limit: schema.number().int().positive().max(200).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const result = await callSessionList(projectDir, limit);
        return JSON.stringify({ sessionID, directory: projectDir, limit: limit ?? null, ...result }, null, 2);
      },
    }),

    ctf_orch_session_read: tool({
      description: "Read recent messages from a session",
      args: {
        target_session_id: schema.string().min(1),
        message_limit: schema.number().int().positive().max(200).default(50),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const targetSessionID = args.target_session_id;
        const limit = args.message_limit;
        const result = await callSessionMessages(projectDir, targetSessionID, limit);
        const messages: Array<{ role: string; text: string }> = [];
        if (result.ok) {
          for (const msg of result.data) {
            if (!isRecord(msg)) continue;
            const role =
              typeof msg.role === "string"
                ? msg.role
                : isRecord(msg.info) && typeof msg.info.role === "string"
                  ? String(msg.info.role)
                  : "";
            const parts = Array.isArray(msg.parts) ? msg.parts : [];
            const text = parts
              .map((p: unknown) => (isRecord(p) && typeof p.text === "string" ? p.text : ""))
              .filter(Boolean)
              .join("\n")
              .trim();
            if (!text) continue;
            messages.push({ role: role || "unknown", text });
          }
        }
        return JSON.stringify(
          {
            sessionID,
            directory: projectDir,
            targetSessionID,
            messageLimit: limit,
            ok: result.ok,
            ...(result.ok ? { messages } : { reason: result.reason }),
          },
          null,
          2,
        );
      },
    }),

    ctf_orch_session_search: tool({
      description: "Search text in recent messages across sessions (best-effort)",
      args: {
        query: schema.string().min(1),
        max_sessions: schema.number().int().positive().max(200).default(25),
        message_limit: schema.number().int().positive().max(200).default(40),
        case_sensitive: schema.boolean().default(false),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const q = args.case_sensitive ? args.query : args.query.toLowerCase();
        const list = await callSessionList(projectDir, args.max_sessions);
        if (!list.ok) {
          return JSON.stringify({ sessionID, ok: false, reason: list.reason, directory: projectDir }, null, 2);
        }

        const sessionIDs: string[] = [];
        for (const item of list.data) {
          if (isRecord(item) && typeof item.id === "string" && item.id.trim().length > 0) {
            sessionIDs.push(item.id.trim());
          }
        }

        const hits: Array<{ sessionID: string; role: string; preview: string }> = [];
        for (const targetSessionID of sessionIDs.slice(0, args.max_sessions)) {
          const read = await callSessionMessages(projectDir, targetSessionID, args.message_limit);
          if (!read.ok) continue;
          for (const msg of read.data) {
            if (!isRecord(msg)) continue;
            const role =
              typeof msg.role === "string"
                ? msg.role
                : isRecord(msg.info) && typeof msg.info.role === "string"
                  ? String(msg.info.role)
                  : "";
            const parts = Array.isArray(msg.parts) ? msg.parts : [];
            const text = parts
              .map((p: unknown) => (isRecord(p) && typeof p.text === "string" ? p.text : ""))
              .filter(Boolean)
              .join("\n")
              .trim();
            if (!text) continue;
            const hay = args.case_sensitive ? text : text.toLowerCase();
            if (!hay.includes(q)) continue;
            hits.push({ sessionID: targetSessionID, role: role || "unknown", preview: text.slice(0, 300) });
            if (hits.length >= 200) break;
          }
          if (hits.length >= 200) break;
        }

        return JSON.stringify(
          {
            sessionID,
            ok: true,
            directory: projectDir,
            query: args.query,
            maxSessions: args.max_sessions,
            messageLimit: args.message_limit,
            hits,
          },
          null,
          2,
        );
      },
    }),

    ctf_orch_session_info: tool({
      description: "Get best-effort metadata for a single session",
      args: {
        target_session_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const targetSessionID = args.target_session_id;
        const list = await callSessionList(projectDir, 200);
        const found =
          list.ok && Array.isArray(list.data)
            ? list.data.find((item) => isRecord(item) && String(item.id ?? "") === targetSessionID)
            : null;
        return JSON.stringify(
          {
            sessionID,
            directory: projectDir,
            targetSessionID,
            ok: true,
            found: Boolean(found),
            item: found ?? null,
          },
          null,
          2,
        );
      },
    }),

    ctf_orch_windows_cli_fallback: tool({
      description: "Plan a Windows GUI-to-CLI fallback, including install/search commands when a CLI tool is missing",
      args: {
        tool: schema.string().min(1),
        purpose: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const plan = buildWindowsCliFallbackPlan(args.tool, args.purpose);
        return JSON.stringify(
          {
            ok: true,
            sessionID,
            platform: process.platform,
            windowsRecommended: true,
            plan,
          },
          null,
          2,
        );
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
            : state.lastFailureReason === "input_validation_non_retryable"
              ? "Input validation failure: fix payload/schema issues (e.g., invalid_request_error) before retrying the same route."
            : state.lastFailureReason === "tooling_timeout" || state.lastFailureReason === "context_overflow"
              ? "Use failover/compaction path and reduce output/context size before retry."
            : state.lastFailureReason === "hypothesis_stall"
                ? "Pivot hypothesis immediately and run cheapest disconfirm test next."
                : state.lastFailureReason === "unsat_claim"
                  ? "UNSAT gate active: require at least two alternatives and reproducible observation evidence before unsat conclusion; continue disconfirm loop."
                  : state.lastFailureReason === "static_dynamic_contradiction"
                    ? "Static/dynamic contradiction detected: run extraction-first pivot on target-aware scan route, then escalate via stuck route."
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

    ctf_orch_doctor: tool({
      description:
        "Diagnose environment/provider/model readiness (providers, models, and Aegis/OpenCode config cohesion)",
      args: {
        include_models: schema.boolean().optional(),
        max_models: schema.number().int().positive().optional(),
      },
      execute: async (args) => {
        const includeModels = args.include_models === true;
        const maxModels = args.max_models ?? 10;

        const readiness = buildReadinessReport(projectDir, notesStore, config);
        const providerResult = await callConfigProviders(projectDir);

        const usedModels = extractAgentModels(readiness.checkedConfigPath);
        const usedProviders = [...new Set(usedModels.map(providerIdFromModel).filter(Boolean))];

        const providerSummary =
          providerResult.ok && providerResult.data
            ? (providerResult.data.providers as Array<Record<string, unknown>>).map((p) => {
                const id = typeof p.id === "string" ? p.id : "";
                const name = typeof p.name === "string" ? p.name : "";
                const source = typeof p.source === "string" ? p.source : "";
                const env = Array.isArray(p.env) ? p.env : [];
                const modelsObj = isRecord(p.models) ? p.models : {};
                const modelKeys = Object.keys(modelsObj);
                return {
                  id,
                  name,
                  source,
                  env,
                  modelCount: modelKeys.length,
                  models: includeModels ? modelKeys.slice(0, maxModels) : undefined,
                };
              })
            : [];

        const availableProviderIds = new Set(providerSummary.map((p) => p.id).filter(Boolean));
        const missingProviders = usedProviders.filter((pid) => pid && !availableProviderIds.has(pid));

        const modelLookup = new Map<string, Set<string>>();
        for (const p of providerSummary) {
          if (!p.id) continue;
          const models = new Set<string>();
          if (Array.isArray(p.models)) {
            for (const m of p.models) {
              if (typeof m === "string" && m) models.add(m);
            }
          }
          modelLookup.set(p.id, models);
        }

        const missingModels: Array<{ model: string; reason: string }> = [];
        if (includeModels) {
          for (const m of usedModels) {
            const pid = providerIdFromModel(m);
            const mid = modelIdFromModel(m);
            const models = modelLookup.get(pid);
            if (!models) {
              continue;
            }
            if (models.has(m) || (mid && models.has(mid))) {
              continue;
            }
            missingModels.push({
              model: m,
              reason: `model id not found in provider '${pid}' (checked '${m}' and '${mid}')`,
            });
          }
        }

        return JSON.stringify(
          {
            readiness,
            providers: providerResult.ok
              ? { ok: true, count: providerSummary.length, providers: providerSummary }
              : { ok: false, reason: providerResult.reason },
            agentModels: {
              usedModels,
              usedProviders,
              missingProviders,
              missingModels,
            },
          },
          null,
          2
        );
      },
    }),

    ctf_orch_slash: tool({
      description: "Run an OpenCode slash workflow by submitting a synthetic prompt",
      args: {
        command: schema.enum(["init-deep", "refactor", "start-work", "ralph-loop", "ulw-loop"]),
        arguments: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const command = args.command;
        const extra = (args.arguments ?? "").trim();
        const text = extra ? `/${command} ${extra}` : `/${command}`;
        const result = await callPromptAsync(sessionID, text, {
          source: "oh-my-Aegis.slash",
          command,
        });
        return JSON.stringify({ sessionID, command, text, ...result }, null, 2);
      },
    }),

    ctf_orch_exploit_template_list: tool({
      description: "List built-in exploit templates by domain",
      args: {
        domain: schema.enum(["PWN", "CRYPTO", "WEB", "WEB3", "REV", "FORENSICS", "MISC"]).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const domain = args.domain as
          | "PWN"
          | "CRYPTO"
          | "WEB"
          | "WEB3"
          | "REV"
          | "FORENSICS"
          | "MISC"
          | undefined;
        const templates = listExploitTemplates(domain);
        return JSON.stringify({ sessionID, domain: domain ?? "ALL", templates }, null, 2);
      },
    }),

    ctf_orch_exploit_template_get: tool({
      description: "Get a built-in exploit template by id",
      args: {
        domain: schema.enum(["PWN", "CRYPTO", "WEB", "WEB3", "REV", "FORENSICS", "MISC"]),
        id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const entry = getExploitTemplate(
          args.domain as "PWN" | "CRYPTO" | "WEB" | "WEB3" | "REV" | "FORENSICS" | "MISC",
          args.id,
        );
        if (!entry) {
          return JSON.stringify({ ok: false, reason: "template not found", sessionID, domain: args.domain, id: args.id }, null, 2);
        }
        return JSON.stringify({ ok: true, sessionID, template: entry }, null, 2);
      },
    }),

    ctf_auto_triage: tool({
      description: "Auto-triage a challenge file: detect type, suggest target, generate scan commands",
      args: {
        file_path: schema.string().min(1),
        file_output: schema.string().optional(),
      },
      execute: async (args) => {
        const result = triageFile(args.file_path, args.file_output);
        return JSON.stringify(result, null, 2);
      },
    }),

    ctf_gemini_cli: tool({
      description: "Call Gemini CLI headless and return a structured JSON result",
      args: {
        prompt: schema.string().min(1),
        model: schema.string().optional(),
        timeout_ms: schema.number().int().positive().optional(),
        max_output_chars: schema.number().int().positive().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const proposalContext = buildToolProposalContext(projectDir, sessionID);
        try {
          const result = await runGeminiCli({
            prompt: args.prompt,
            model: args.model,
            timeoutMs: args.timeout_ms,
            maxOutputChars: args.max_output_chars,
            proposal_context: proposalContext,
            env: process.env,
          });
          return JSON.stringify({ sessionID, ...result }, null, 2);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ ok: false, sessionID, reason: message }, null, 2);
        }
      },
    }),

    ctf_claude_code: tool({
      description: "Call Claude Code CLI headless and return a structured JSON result",
      args: {
        prompt: schema.string().min(1),
        model: schema.string().optional(),
        timeout_ms: schema.number().int().positive().optional(),
        max_output_chars: schema.number().int().positive().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const proposalContext = buildToolProposalContext(projectDir, sessionID);
        try {
          const result = await runClaudeCodeCli({
            prompt: args.prompt,
            model: args.model,
            timeoutMs: args.timeout_ms,
            maxOutputChars: args.max_output_chars,
            proposal_context: proposalContext,
            env: process.env,
          });
          return JSON.stringify({ sessionID, ...result }, null, 2);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ ok: false, sessionID, reason: message }, null, 2);
        }
      },
    }),
  };
}
