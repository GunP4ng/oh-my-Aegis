import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../config/schema";
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
} from "../orchestration/parallel";
import type { ParallelBackgroundManager } from "../orchestration/parallel-background";
import type { SessionStore } from "../state/session-store";

const schema = tool.schema;

export function createParallelTools(
  store: SessionStore,
  config: OrchestratorConfig,
  projectDir: string,
  client: unknown,
  parallelBackgroundManager: ParallelBackgroundManager,
): Record<string, ToolDefinition> {
  return {
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
            { parallel: config.parallel },
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
        const results = await collectResults(sessionClient, activeGroup, projectDir, messageLimit);

        if (args.winner_session_id) {
          const abortedCount = await abortAllExcept(
            sessionClient,
            activeGroup,
            args.winner_session_id,
            projectDir,
          );
          return JSON.stringify({
            ok: true,
            sessionID,
            winnerDeclared: args.winner_session_id,
            abortedTracks: abortedCount,
            group: groupSummary(activeGroup),
            results: results.map((r) => ({
              sessionID: r.sessionID,
              purpose: r.purpose,
              agent: r.agent,
              status: r.status,
              resultPreview: r.lastAssistantMessage.slice(0, 500),
            })),
          }, null, 2);
        }

        return JSON.stringify({
          ok: true,
          sessionID,
          group: groupSummary(activeGroup),
          results: results.map((r) => ({
            sessionID: r.sessionID,
            purpose: r.purpose,
            agent: r.agent,
            status: r.status,
            resultPreview: r.lastAssistantMessage.slice(0, 500),
          })),
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
