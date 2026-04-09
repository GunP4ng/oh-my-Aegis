import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { SessionStore } from "../../state/session-store";
import type { OrchestratorConfig } from "../../config/schema";
import { isRecord } from "../../utils/is-record";
import { isInteractiveEnabledForSession as isInteractiveEnabledForSessionHelper } from "./helpers";

const schema = tool.schema;

export interface PtyToolDeps {
  store: SessionStore;
  config: OrchestratorConfig;
  projectDir: string;
  client: unknown;
}

/* ── PTY helpers ── */

const unwrapPtyResult = (result: unknown): unknown => {
  if (isRecord(result) && Object.prototype.hasOwnProperty.call(result, "data")) {
    return (result as Record<string, unknown>).data;
  }
  return result;
};

const ptyErrorMessage = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  if (!Object.prototype.hasOwnProperty.call(value, "error")) return null;

  const err = (value as Record<string, unknown>).error;
  if (typeof err === "string") return err;
  if (!isRecord(err)) return "unknown pty error";

  const data = err.data;
  if (isRecord(data) && typeof data.message === "string" && data.message.trim().length > 0) {
    return data.message;
  }
  if (typeof err.message === "string" && err.message.trim().length > 0) {
    return err.message;
  }
  if (typeof err.name === "string" && err.name.trim().length > 0) {
    return err.name;
  }
  return "unknown pty error";
};

const runPtyAttempts = async <T>(
  fn: (args: unknown) => Promise<unknown>,
  attempts: Array<{ label: string; args: unknown }>,
  parse: (value: unknown) => T | null,
  noDataReason: string,
): Promise<{ ok: true; data: T } | { ok: false; reason: string }> => {
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const raw = await fn(attempt.args);
      const unwrapped = unwrapPtyResult(raw);
      const err = ptyErrorMessage(raw) ?? ptyErrorMessage(unwrapped);
      if (err) {
        failures.push(`${attempt.label}: ${err}`);
        continue;
      }

      const parsed = parse(unwrapped);
      if (parsed !== null) {
        return { ok: true as const, data: parsed };
      }
      failures.push(`${attempt.label}: no-data`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${attempt.label}: ${message}`);
    }
  }

  if (failures.length > 0) {
    return { ok: false as const, reason: `${noDataReason}: ${failures.join(" | ").slice(0, 600)}` };
  }
  return { ok: false as const, reason: noDataReason };
};

/* ── PTY API call wrappers ── */

function buildPtyCallWrappers(client: unknown) {
  const callPtyCreate = async (directory: string, body: Record<string, unknown>) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const rawCreateFn = (ptyApi as { create?: unknown } | null)?.create;
    if (typeof rawCreateFn !== "function") {
      return { ok: false as const, reason: "client.pty.create unavailable" };
    }
    const createFn = (rawCreateFn as (args: unknown) => Promise<unknown>).bind(ptyApi);
    return runPtyAttempts(
      createFn,
      [
        { label: "v1-query-body", args: { query: { directory }, body } },
        { label: "v2-flat", args: { directory, ...body } },
      ],
      (value) => (isRecord(value) ? value : null),
      "pty.create returned no data",
    );
  };

  const callPtyList = async (directory: string) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const rawListFn = (ptyApi as { list?: unknown } | null)?.list;
    if (typeof rawListFn !== "function") {
      return { ok: false as const, reason: "client.pty.list unavailable" };
    }
    const listFn = (rawListFn as (args: unknown) => Promise<unknown>).bind(ptyApi);
    return runPtyAttempts(
      listFn,
      [
        { label: "v2-flat", args: { directory } },
        { label: "v1-query", args: { query: { directory } } },
      ],
      (value) => (Array.isArray(value) ? value : null),
      "pty.list returned unexpected data",
    );
  };

  const callPtyRemove = async (directory: string, ptyID: string) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const rawRemoveFn = (ptyApi as { remove?: unknown } | null)?.remove;
    if (typeof rawRemoveFn !== "function") {
      return { ok: false as const, reason: "client.pty.remove unavailable" };
    }
    const removeFn = (rawRemoveFn as (args: unknown) => Promise<unknown>).bind(ptyApi);
    return runPtyAttempts(
      removeFn,
      [
        { label: "v2-flat-ptyID", args: { ptyID, directory } },
        { label: "v2-flat-id", args: { id: ptyID, directory } },
        { label: "v1-path-id", args: { path: { id: ptyID }, query: { directory } } },
        { label: "v1-path-ptyID", args: { path: { ptyID }, query: { directory } } },
      ],
      (value) => (value === undefined || value === null ? null : value),
      "pty.remove returned unexpected data",
    );
  };

  const callPtyGet = async (directory: string, ptyID: string): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reason: string }> => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const rawGetFn = (ptyApi as { get?: unknown } | null)?.get;
    if (typeof rawGetFn !== "function") {
      return { ok: false as const, reason: "client.pty.get unavailable" };
    }
    const getFn = (rawGetFn as (args: unknown) => Promise<unknown>).bind(ptyApi);
    const result = await runPtyAttempts(
      getFn,
      [
        { label: "v2-flat-ptyID", args: { ptyID, directory } },
        { label: "v2-flat-id", args: { id: ptyID, directory } },
        { label: "v1-path-id", args: { path: { id: ptyID }, query: { directory } } },
        { label: "v1-path-ptyID", args: { path: { ptyID }, query: { directory } } },
      ],
      (value) => (isRecord(value) ? value : null),
      "pty.get returned no data",
    );

    if (result.ok) {
      return result;
    }

    const listed = await callPtyList(directory);
    if (listed.ok) {
      const match = listed.data.find(
        (item) => isRecord(item) && typeof item.id === "string" && item.id === ptyID,
      );
      if (isRecord(match)) {
        return { ok: true as const, data: match };
      }
    }

    return result;
  };

  const callPtyUpdate = async (directory: string, ptyID: string, body: Record<string, unknown>) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const rawUpdateFn = (ptyApi as { update?: unknown } | null)?.update;
    if (typeof rawUpdateFn !== "function") {
      return { ok: false as const, reason: "client.pty.update unavailable" };
    }
    const updateFn = (rawUpdateFn as (args: unknown) => Promise<unknown>).bind(ptyApi);
    const result = await runPtyAttempts(
      updateFn,
      [
        { label: "v2-flat-ptyID", args: { ptyID, directory, ...body } },
        { label: "v2-flat-id", args: { id: ptyID, directory, ...body } },
        { label: "v1-path-id", args: { path: { id: ptyID }, query: { directory }, body } },
        { label: "v1-path-ptyID", args: { path: { ptyID }, query: { directory }, body } },
      ],
      (value) => (isRecord(value) ? value : null),
      "pty.update returned unexpected data",
    );

    if (result.ok) {
      return result;
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return result;
    }

    const listed = await callPtyList(directory);
    if (!listed.ok) {
      return result;
    }
    const current = listed.data.find(
      (item) => isRecord(item) && typeof item.id === "string" && item.id === ptyID,
    );
    if (!isRecord(current)) {
      return result;
    }

    const command = typeof current.command === "string" && current.command.trim().length > 0
      ? current.command
      : "/bin/bash";
    const args = Array.isArray(current.args)
      ? current.args.filter((v): v is string => typeof v === "string")
      : ["-l"];
    const cwd = typeof current.cwd === "string" && current.cwd.trim().length > 0 ? current.cwd : undefined;

    const recreated = await callPtyCreate(directory, {
      command,
      args,
      ...(cwd ? { cwd } : {}),
      title,
    });
    if (!recreated.ok) {
      return result;
    }

    const removed = await callPtyRemove(directory, ptyID);
    return {
      ok: true as const,
      data: {
        ...(recreated.data as Record<string, unknown>),
        replacedFrom: ptyID,
        removedOriginal: removed.ok,
        fallback: "recreate",
      },
    };
  };

  const callPtyConnect = async (directory: string, ptyID: string) => {
    const ptyApi = (client as { pty?: unknown } | null)?.pty as unknown;
    const rawConnectFn = (ptyApi as { connect?: unknown } | null)?.connect;
    if (typeof rawConnectFn !== "function") {
      return { ok: false as const, reason: "client.pty.connect unavailable" };
    }
    const connectFn = (rawConnectFn as (args: unknown) => Promise<unknown>).bind(ptyApi);
    const result = await runPtyAttempts(
      connectFn,
      [
        { label: "v2-flat-ptyID", args: { ptyID, directory } },
        { label: "v2-flat-id", args: { id: ptyID, directory } },
        { label: "v1-path-id", args: { path: { id: ptyID }, query: { directory } } },
        { label: "v1-path-ptyID", args: { path: { ptyID }, query: { directory } } },
      ],
      (value) => (value === undefined || value === null ? null : value),
      "pty.connect returned no data",
    );

    if (result.ok) {
      return result;
    }

    const got = await callPtyGet(directory, ptyID);
    if (got.ok) {
      return {
        ok: true as const,
        data: {
          ptyID,
          directory,
          connectSupported: false,
          reason: result.reason,
          session: got.data,
        },
      };
    }

    return result;
  };

  return { callPtyCreate, callPtyList, callPtyGet, callPtyUpdate, callPtyRemove, callPtyConnect };
}

/* ── Factory ── */

export function createPtyTools(deps: PtyToolDeps): Record<string, ToolDefinition> {
  const { store, config, projectDir, client } = deps;
  const { callPtyCreate, callPtyList, callPtyGet, callPtyUpdate, callPtyRemove, callPtyConnect } =
    buildPtyCallWrappers(client);

  const isInteractiveEnabledForSession = (sessionID: string): boolean =>
    isInteractiveEnabledForSessionHelper(store, config, sessionID);

  return {
    ctf_orch_pty_create: tool({
      description: "Create a PTY session for interactive workflows",
      args: {
        command: schema.string().min(1),
        args: schema.array(schema.string()).optional(),
        cwd: schema.string().optional(),
        title: schema.string().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const body: Record<string, unknown> = {
          command: args.command,
        };
        if (args.args) body.args = args.args;
        if (args.cwd) body.cwd = args.cwd;
        if (args.title) body.title = args.title;
        const result = await callPtyCreate(projectDir, body);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_list: tool({
      description: "List PTY sessions for this project",
      args: {},
      execute: async (_args, context) => {
        const sessionID = context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyList(projectDir);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_get: tool({
      description: "Get a PTY session by id",
      args: {
        pty_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyGet(projectDir, args.pty_id);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_update: tool({
      description: "Update a PTY session (title/size)",
      args: {
        pty_id: schema.string().min(1),
        title: schema.string().optional(),
        rows: schema.number().int().positive().optional(),
        cols: schema.number().int().positive().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const body: Record<string, unknown> = {};
        if (args.title) body.title = args.title;
        if (args.rows && args.cols) {
          body.size = { rows: args.rows, cols: args.cols };
        }
        const result = await callPtyUpdate(projectDir, args.pty_id, body);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_remove: tool({
      description: "Remove (terminate) a PTY session",
      args: {
        pty_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyRemove(projectDir, args.pty_id);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_orch_pty_connect: tool({
      description: "Connect info for a PTY session",
      args: {
        pty_id: schema.string().min(1),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!isInteractiveEnabledForSession(sessionID)) {
          return JSON.stringify({ ok: false, reason: "interactive disabled", sessionID }, null, 2);
        }
        const result = await callPtyConnect(projectDir, args.pty_id);
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),
  };
}
