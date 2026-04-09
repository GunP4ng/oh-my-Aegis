import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { SessionStore } from "../../state/session-store";
import { defaultSharedMessageSource } from "./helpers";
import { randomUUID } from "node:crypto";

const schema = tool.schema;

/* ------------------------------------------------------------------ */
/*  Deps interface                                                    */
/* ------------------------------------------------------------------ */

export interface ChannelToolDeps {
  store: SessionStore;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function createChannelTools(deps: ChannelToolDeps): Record<string, ToolDefinition> {
  const { store } = deps;

  return {
    ctf_orch_channel_publish: tool({
      description: "Publish a shared progress/findings message for the orchestrator or sibling subagents",
      args: {
        channel_id: schema.string().optional(),
        from: schema.string().optional(),
        to: schema.string().optional(),
        kind: schema.string().optional(),
        summary: schema.string().min(1),
        refs: schema.array(schema.string()).optional(),
        message_id: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const channelID = (args.channel_id ?? "shared").trim() || "shared";
        const message = store.publishSharedMessage(sessionID, channelID, {
          id: (args.message_id ?? "").trim() || randomUUID(),
          from: defaultSharedMessageSource(store, sessionID, args.from),
          to: (args.to ?? "all").trim() || "all",
          kind: (args.kind ?? "note").trim() || "note",
          summary: args.summary.trim(),
          refs: (args.refs ?? []).map((ref) => ref.trim()).filter((ref) => ref.length > 0).slice(0, 20),
        });
        return JSON.stringify({ ok: true, sessionID, channelID, message }, null, 2);
      },
    }),

    ctf_orch_channel_read: tool({
      description: "Read shared orchestrator/subagent messages from the session message bus",
      args: {
        channel_id: schema.string().optional(),
        since_seq: schema.number().int().nonnegative().optional(),
        limit: schema.number().int().positive().max(100).optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        const channelID = (args.channel_id ?? "shared").trim() || "shared";
        const messages = store.readSharedMessages(
          sessionID,
          channelID,
          typeof args.since_seq === "number" ? args.since_seq : 0,
          typeof args.limit === "number" ? args.limit : 20,
        );
        return JSON.stringify(
          {
            ok: true,
            sessionID,
            channelID,
            count: messages.length,
            latestSeq: messages.at(-1)?.seq ?? 0,
            messages,
          },
          null,
          2,
        );
      },
    }),
  };
}
