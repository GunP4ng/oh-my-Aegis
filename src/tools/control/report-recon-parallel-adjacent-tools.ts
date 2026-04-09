import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../../config/schema";
import type { SessionStore } from "../../state/session-store";
import type { NotesStore } from "../../state/notes-store";
import type { TargetType, FailureReason } from "../../state/types";
import type { ParallelBackgroundManager } from "../../orchestration/parallel-background";
import { scanForFlags, getCandidates, buildFlagAlert, setCustomFlagPattern } from "../../orchestration/flag-detector";
import { matchPatterns, buildPatternSummary } from "../../orchestration/pattern-matcher";
import { recommendedTools } from "../../orchestration/tool-integration";
import { planReconPipeline } from "../../orchestration/recon-pipeline";
import { saveScanSnapshot, buildDeltaSummary, shouldRescan, getLatestSnapshot, computeDelta, type ScanSnapshot } from "../../orchestration/delta-scan";
import { localLookup, buildLibcSummary, computeLibcBase, buildLibcRipUrl, type LibcLookupRequest } from "../../orchestration/libc-database";
import { buildParityReport, buildParitySummary, parseDockerfile, parseLddOutput, localEnvCommands, type EnvInfo } from "../../orchestration/env-parity";
import { runParityRunner } from "../../orchestration/parity-runner";
import { runContradictionRunner } from "../../orchestration/contradiction-runner";
import { generateReport, formatReportMarkdown } from "../../orchestration/report-generator";
import { planExploreDispatch, planLibrarianDispatch, detectSubagentType } from "../../orchestration/subagent-dispatch";
import { appendEvidenceLedger, scoreEvidence, type EvidenceEntry, type EvidenceType } from "../../orchestration/evidence-ledger";
import {
  abortAll,
  abortAllExcept,
  collectResults,
  dispatchParallel,
  extractSessionClient,
  getActiveGroup,
  getGroups,
  groupSummary,
  planDeepWorkerDispatch,
  planHypothesisDispatch,
  planScanDispatch,
  type DispatchPlan,
} from "../../orchestration/parallel";
import { randomUUID } from "node:crypto";

const schema = tool.schema;

/* ------------------------------------------------------------------ */
/*  Deps interface                                                    */
/* ------------------------------------------------------------------ */

export interface ReportReconParallelDeps {
  store: SessionStore;
  notesStore: NotesStore;
  config: OrchestratorConfig;
  projectDir: string;
  client: unknown;
  parallelBackgroundManager: ParallelBackgroundManager;
  /** Returns a JSON error string if BOUNTY scope is unconfirmed, or null if OK. */
  blockIfBountyScopeUnconfirmed: (sessionID: string, toolName: string) => string | null;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function createReportReconParallelAdjacentTools(
  deps: ReportReconParallelDeps,
): Record<string, ToolDefinition> {
  const {
    store,
    notesStore,
    config,
    projectDir,
    client,
    parallelBackgroundManager,
    blockIfBountyScopeUnconfirmed,
  } = deps;

  return {
    ctf_flag_scan: tool({
      description: "Scan text for flag patterns and return candidates",
      args: {
        text: schema.string().min(1),
        source: schema.string().default("manual"),
        custom_pattern: schema.string().optional(),
      },
      execute: async (args) => {
        if (args.custom_pattern) {
          setCustomFlagPattern(args.custom_pattern);
        }
        const found = scanForFlags(args.text, args.source);
        return JSON.stringify({
          found,
          alert: found.length > 0 ? buildFlagAlert(found) : null,
          allCandidates: getCandidates(),
        }, null, 2);
      },
    }),

    ctf_pattern_match: tool({
      description: "Match known CTF/security patterns in text",
      args: {
        text: schema.string().min(1),
        target_type: schema.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"]).optional(),
      },
      execute: async (args) => {
        const targetType = args.target_type as TargetType | undefined;
        const matches = matchPatterns(args.text, targetType);
        return JSON.stringify({
          matches,
          summary: matches.length > 0 ? buildPatternSummary(matches) : "No patterns matched.",
        }, null, 2);
      },
    }),

    ctf_recon_pipeline: tool({
      description: "Plan a multi-phase BOUNTY recon pipeline for a target",
      args: {
        target: schema.string().min(1),
        scope: schema.array(schema.string()).optional(),
        templates: schema.string().optional(),
      },
      execute: async (args, context) => {
        const blocked = blockIfBountyScopeUnconfirmed(context.sessionID, "ctf_recon_pipeline");
        if (blocked) {
          return blocked;
        }
        const state = store.get(context.sessionID);
        const pipeline = planReconPipeline(state, config, args.target, { scope: args.scope });
        return JSON.stringify({ pipeline, templates: args.templates ?? null }, null, 2);
      },
    }),

    ctf_delta_scan: tool({
      description: "Save/query/compare scan snapshots for delta-aware scanning",
      args: {
        action: schema.enum(["save", "query", "should_rescan"]),
        target: schema.string().min(1),
        template_set: schema.string().default("default"),
        findings: schema.array(schema.string()).optional(),
        hosts: schema.array(schema.string()).optional(),
        ports: schema.array(schema.number()).optional(),
        max_age_ms: schema.number().optional(),
      },
      execute: async (args, context) => {
        const blocked = blockIfBountyScopeUnconfirmed(context.sessionID, "ctf_delta_scan");
        if (blocked) {
          return blocked;
        }
        if (args.action === "save") {
          const snapshot: ScanSnapshot = {
            id: randomUUID(),
            target: args.target,
            templateSet: args.template_set,
            timestamp: Date.now(),
            assets: [
              ...(args.hosts ?? []),
              ...((args.ports ?? []).map((p) => `port:${String(p)}`)),
            ],
            findings: args.findings ?? [],
          };
          saveScanSnapshot(snapshot);
          return JSON.stringify({ ok: true, saved: snapshot }, null, 2);
        }
        if (args.action === "query") {
          const current: ScanSnapshot = {
            id: randomUUID(),
            target: args.target,
            templateSet: args.template_set,
            timestamp: Date.now(),
            assets: [
              ...(args.hosts ?? []),
              ...((args.ports ?? []).map((p) => `port:${String(p)}`)),
            ],
            findings: args.findings ?? [],
          };
          const latest = getLatestSnapshot(args.target);
          const delta = latest ? computeDelta(latest, current) : null;
          const summary = buildDeltaSummary(args.target, {
            ...current,
          });
          return JSON.stringify({ ok: true, summary, latest, delta }, null, 2);
        }
        if (args.action === "should_rescan") {
          const rescan = shouldRescan(args.target, args.template_set, args.max_age_ms);
          return JSON.stringify({ ok: true, shouldRescan: rescan }, null, 2);
        }
        return JSON.stringify({ ok: false, reason: "unknown action" }, null, 2);
      },
    }),

    ctf_tool_recommend: tool({
      description: "Get recommended security tools for a target type",
      args: {
        target_type: schema.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"]),
      },
      execute: async (args, context) => {
        const blocked = blockIfBountyScopeUnconfirmed(context.sessionID, "ctf_tool_recommend");
        if (blocked) {
          return blocked;
        }
        const tools = recommendedTools(args.target_type as TargetType);
        return JSON.stringify({ tools }, null, 2);
      },
    }),

    ctf_libc_lookup: tool({
      description: "Lookup libc versions from leaked function addresses",
      args: {
        lookups: schema.array(schema.object({
          symbol: schema.string().min(1),
          address: schema.string().min(1),
        })),
        compute_base_leaked_address: schema.string().optional(),
        compute_base_symbol_offset: schema.number().optional(),
      },
      execute: async (args) => {
        const requests: LibcLookupRequest[] = args.lookups.map(l => ({
          symbolName: l.symbol,
          address: l.address,
        }));
        const result = localLookup(requests);
        const summary = buildLibcSummary(result);
        const libcRipUrl = buildLibcRipUrl(requests);
        let base: string | null = null;
        if (args.compute_base_leaked_address && typeof args.compute_base_symbol_offset === "number") {
          base = computeLibcBase(args.compute_base_leaked_address, args.compute_base_symbol_offset);
        }
        return JSON.stringify({ result, summary, libcRipUrl, computedBase: base }, null, 2);
      },
    }),

    ctf_env_parity: tool({
      description: "Check environment parity between local and remote for PWN challenges",
      args: {
        dockerfile_content: schema.string().optional(),
        ldd_output: schema.string().optional(),
        binary_path: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const hasRemote = typeof args.dockerfile_content === "string" && args.dockerfile_content.trim().length > 0;
        const hasLocal = typeof args.ldd_output === "string" && args.ldd_output.trim().length > 0;
        if (!hasRemote || !hasLocal) {
          store.setEnvParity(sessionID, false, "Parity baseline requires both remote (dockerfile) and local (ldd) evidence.");
          return JSON.stringify(
            {
              ok: false,
              sessionID,
              reason: "ctf_env_parity requires both dockerfile_content and ldd_output for enforceable parity baseline",
            },
            null,
            2,
          );
        }
        const remote: Partial<EnvInfo> = {};
        if (args.dockerfile_content) {
          Object.assign(remote, parseDockerfile(args.dockerfile_content));
        }
        const local: Partial<EnvInfo> = {};
        if (args.ldd_output) {
          const parsed = parseLddOutput(args.ldd_output);
          if (parsed) {
            local.libcVersion = parsed.version;
            local.libcPath = parsed.libcPath;
          }
        }
        const report = buildParityReport(local, remote);
        const summary = buildParitySummary(report);
        const localCommands = localEnvCommands();
        store.setEnvParity(sessionID, report.allMatch, summary);
        return JSON.stringify({ report, summary, localCommands }, null, 2);
      },
    }),

    ctf_parity_runner: tool({
      description: "Run local/docker/remote parity comparison on concrete outputs",
      args: {
        local_output: schema.string().optional(),
        docker_output: schema.string().optional(),
        remote_output: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const result = runParityRunner({
          localOutput: args.local_output,
          dockerOutput: args.docker_output,
          remoteOutput: args.remote_output,
        });
        if (result.checkedPairs > 0) {
          store.setEnvParity(sessionID, result.ok, result.summary);
        }
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_contradiction_runner: tool({
      description: "Compare expected hypothesis outcomes vs observed runtime output",
      args: {
        hypothesis: schema.string().default(""),
        expected: schema.array(schema.string()).default([]),
        observed_output: schema.string().default(""),
        expected_exit_code: schema.number().int().optional(),
        observed_exit_code: schema.number().int().optional(),
        apply_event: schema.boolean().default(true),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const result = runContradictionRunner({
          hypothesis: args.hypothesis,
          expected: args.expected,
          observedOutput: args.observed_output,
          expectedExitCode: args.expected_exit_code,
          observedExitCode: args.observed_exit_code,
        });
        if (result.contradictory && args.apply_event) {
          store.recordFailure(sessionID, "static_dynamic_contradiction" as FailureReason, "ctf_contradiction_runner", result.summary);
          store.applyEvent(sessionID, "static_dynamic_contradiction");
        }
        return JSON.stringify({ sessionID, result }, null, 2);
      },
    }),

    ctf_evidence_ledger: tool({
      description: "Append/scoring evidence ledger entries with L0-L3 output",
      args: {
        event: schema.string().default("manual"),
        evidence_type: schema.enum([
          "string_pattern",
          "static_reverse",
          "dynamic_memory",
          "behavioral_runtime",
          "acceptance_oracle",
        ]),
        confidence: schema.number().min(0).max(1).default(0.8),
        summary: schema.string().default(""),
        source: schema.string().default("manual"),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const entry: EvidenceEntry = {
          at: new Date().toISOString(),
          sessionID,
          event: args.event,
          evidenceType: args.evidence_type as EvidenceType,
          confidence: args.confidence,
          summary: args.summary.replace(/\s+/g, " ").trim().slice(0, 240),
          source: args.source,
        };
        const persisted = appendEvidenceLedger(notesStore.getRootDirectory(), entry);
        const scored = scoreEvidence([entry]);
        store.setCandidateLevel(sessionID, scored.level);
        return JSON.stringify({ ok: persisted.ok, sessionID, entry, scored, ...(persisted.ok ? {} : persisted) }, null, 2);
      },
    }),

    ctf_report_generate: tool({
      description: "Generate a CTF writeup or BOUNTY report from session notes",
      args: {
        mode: schema.enum(["CTF", "BOUNTY"]),
        challenge_name: schema.string().default("Challenge"),
        worklog: schema.string().default(""),
        evidence: schema.string().default(""),
        target_type: schema.string().optional(),
        flag: schema.string().optional(),
      },
      execute: async (args) => {
        const reportOptions: Record<string, string> = {
          challengeName: args.challenge_name,
          programName: args.challenge_name,
        };
        if (args.target_type) {
          reportOptions.category = args.target_type;
          reportOptions.endpoint = args.target_type;
        }
        if (args.flag) {
          reportOptions.flag = args.flag;
        }
        const report = generateReport(
          args.mode as "CTF" | "BOUNTY",
          args.worklog,
          args.evidence,
          reportOptions,
        );
        const markdown = formatReportMarkdown(report);
        return JSON.stringify({ report, markdown }, null, 2);
      },
    }),

    ctf_subagent_dispatch: tool({
      description: "Plan a dispatch for aegis-explore or aegis-librarian subagent",
      args: {
        query: schema.string().min(1),
        type: schema.enum(["explore", "librarian", "auto"]).default("auto"),
      },
      execute: async (args, context) => {
        const blocked = blockIfBountyScopeUnconfirmed(context.sessionID, "ctf_subagent_dispatch");
        if (blocked) {
          return blocked;
        }
        const state = store.get(context.sessionID);
        const agentType = args.type === "auto" ? detectSubagentType(args.query) : args.type;
        const plan = agentType === "explore"
          ? planExploreDispatch(state, args.query)
          : planLibrarianDispatch(state, args.query);
        return JSON.stringify({ agentType, plan }, null, 2);
      },
    }),

    // ── Parallel CTF orchestration tools ──

    ctf_parallel_dispatch: tool({
      description:
        "Dispatch parallel child sessions for CTF scanning/hypothesis testing. " +
        "Creates N child sessions, each with a different agent/purpose, and sends prompts concurrently. " +
        "Use plan='scan' for initial parallel recon or plan='hypothesis' with hypotheses array.",
      args: {
        plan: schema.enum(["scan", "hypothesis", "deep_worker"]),
        challenge_description: schema.string().optional(),
        goal: schema.string().optional(),
        hypotheses: schema.string().optional(),
        max_tracks: schema.number().int().min(1).max(5).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const blocked = blockIfBountyScopeUnconfirmed(sessionID, "ctf_parallel_dispatch");
        if (blocked) {
          return blocked;
        }
        const sessionClient = extractSessionClient(client);
        if (!sessionClient) {
          return JSON.stringify({
            ok: false,
            reason: "SDK session client not available (requires session.create + session.promptAsync)",
            sessionID,
          }, null, 2);
        }

        parallelBackgroundManager.bindSessionClient(sessionClient);

        const activeGroup = getActiveGroup(sessionID);
        if (activeGroup) {
          return JSON.stringify({
            ok: false,
            reason: "Active parallel group already exists. Use ctf_parallel_collect or ctf_parallel_abort first.",
            sessionID,
            activeGroup: groupSummary(activeGroup),
          }, null, 2);
        }

        const state = store.get(sessionID);
        const bountyScanDefaultMaxTracks = config.parallel.bounty_scan.max_tracks;
        const maxTracks =
          args.max_tracks ?? (args.plan === "scan" && state.mode === "BOUNTY" ? bountyScanDefaultMaxTracks : 3);

        let dispatchPlan: DispatchPlan;
        if (args.plan === "scan") {
          dispatchPlan = planScanDispatch(state, config, args.challenge_description ?? "");
        } else if (args.plan === "deep_worker") {
          const goal = (args.goal ?? args.challenge_description ?? "").trim();
          dispatchPlan = planDeepWorkerDispatch(state, config, goal);
        } else {
          let parsedHypotheses: Array<{ hypothesis: string; disconfirmTest: string }> = [];
          if (args.hypotheses) {
            try {
              const raw = JSON.parse(args.hypotheses);
              if (Array.isArray(raw)) {
                parsedHypotheses = raw
                  .filter((h: unknown) => h && typeof h === "object")
                  .map((h: Record<string, unknown>) => ({
                    hypothesis: String(h.hypothesis ?? h.h ?? ""),
                    disconfirmTest: String(h.disconfirmTest ?? h.disconfirm ?? h.test ?? ""),
                  }))
                  .filter((h) => h.hypothesis.length > 0);
              }
            } catch {
              return JSON.stringify({
                ok: false,
                reason: "Failed to parse hypotheses JSON. Expected: [{hypothesis, disconfirmTest}, ...]",
                sessionID,
              }, null, 2);
            }
          }
          if (parsedHypotheses.length === 0) {
            return JSON.stringify({
              ok: false,
              reason: "hypothesis plan requires at least one hypothesis in JSON array format",
              sessionID,
            }, null, 2);
          }
          dispatchPlan = planHypothesisDispatch(state, config, parsedHypotheses);
        }

        try {
          const group = await dispatchParallel(
            sessionClient,
            sessionID,
            projectDir,
            dispatchPlan,
            maxTracks,
            { parallel: config.parallel, state },
          );

          parallelBackgroundManager.ensurePolling();
          void parallelBackgroundManager.pollOnce();

          return JSON.stringify({
            ok: true,
            sessionID,
            dispatched: group.tracks.length,
            group: groupSummary(group),
          }, null, 2);
        } catch (error) {
          return JSON.stringify({
            ok: false,
            reason: `Dispatch error: ${error instanceof Error ? error.message : String(error)}`,
            sessionID,
          }, null, 2);
        }
      },
    }),

    ctf_parallel_status: tool({
      description:
        "Check the status of active parallel child sessions. " +
        "Shows each track's purpose, agent, and current status (running/completed/failed/aborted).",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const groups = getGroups(sessionID);
        if (groups.length === 0) {
          return JSON.stringify({
            ok: true,
            sessionID,
            hasActiveGroup: false,
            totalGroups: 0,
            message: "No parallel groups dispatched for this session.",
          }, null, 2);
        }

        const activeGroup = getActiveGroup(sessionID);
        return JSON.stringify({
          ok: true,
          sessionID,
          hasActiveGroup: Boolean(activeGroup),
          totalGroups: groups.length,
          activeGroup: activeGroup ? groupSummary(activeGroup) : null,
          completedGroups: groups
            .filter((g) => g.completedAt > 0)
            .map(groupSummary),
        }, null, 2);
      },
    }),

    ctf_parallel_collect: tool({
      description:
        "Collect results from parallel child sessions. " +
        "Reads messages from each track and returns their last assistant output. " +
        "Optionally declare a winner to abort the rest.",
      args: {
        winner_session_id: schema.string().optional(),
        winner_rationale: schema.string().optional(),
        message_limit: schema.number().int().min(1).max(20).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const sessionClient = extractSessionClient(client);
        if (!sessionClient) {
          return JSON.stringify({
            ok: false,
            reason: "SDK session client not available",
            sessionID,
          }, null, 2);
        }

        parallelBackgroundManager.bindSessionClient(sessionClient);
        await parallelBackgroundManager.pollOnce();

        const activeGroup = getActiveGroup(sessionID);
        if (!activeGroup) {
          const groups = getGroups(sessionID);
          if (groups.length === 0) {
            return JSON.stringify({
              ok: false,
              reason: "No parallel groups exist for this session.",
              sessionID,
            }, null, 2);
          }
          const lastGroup = groups[groups.length - 1];
          return JSON.stringify({
            ok: true,
            sessionID,
            alreadyCompleted: true,
            group: groupSummary(lastGroup),
          }, null, 2);
        }

        const messageLimit = args.message_limit ?? 5;
        const collected = await collectResults(sessionClient, activeGroup, projectDir, messageLimit);

        if (args.winner_session_id) {
          const abortedCount = await abortAllExcept(
            sessionClient,
            activeGroup,
            args.winner_session_id,
            projectDir,
            args.winner_rationale,
          );
          return JSON.stringify({
            ok: true,
            sessionID,
            winnerDeclared: args.winner_session_id,
            abortedTracks: abortedCount,
            group: groupSummary(activeGroup),
            results: collected.results.map((r) => ({
              sessionID: r.sessionID,
              purpose: r.purpose,
              agent: r.agent,
              status: r.status,
              resultPreview: r.lastAssistantMessage.slice(0, 500),
            })),
            merged: collected.merged,
            quarantinedSessionIDs: collected.quarantinedSessionIDs,
          }, null, 2);
        }

        return JSON.stringify({
          ok: true,
          sessionID,
          group: groupSummary(activeGroup),
          results: collected.results.map((r) => ({
            sessionID: r.sessionID,
            purpose: r.purpose,
            agent: r.agent,
            status: r.status,
            resultPreview: r.lastAssistantMessage.slice(0, 500),
          })),
          merged: collected.merged,
          quarantinedSessionIDs: collected.quarantinedSessionIDs,
        }, null, 2);
      },
    }),

    ctf_parallel_abort: tool({
      description:
        "Abort all running parallel child sessions. " +
        "Use when pivoting strategy or when a winner is found via ctf_parallel_collect.",
      args: {
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const sessionClient = extractSessionClient(client);
        if (!sessionClient) {
          return JSON.stringify({
            ok: false,
            reason: "SDK session client not available",
            sessionID,
          }, null, 2);
        }

        const activeGroup = getActiveGroup(sessionID);
        if (!activeGroup) {
          return JSON.stringify({
            ok: true,
            sessionID,
            message: "No active parallel group to abort.",
          }, null, 2);
        }

        const abortedCount = await abortAll(sessionClient, activeGroup, projectDir);
        return JSON.stringify({
          ok: true,
          sessionID,
          abortedTracks: abortedCount,
          group: groupSummary(activeGroup),
        }, null, 2);
      },
    }),
  };
}
