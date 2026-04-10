import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { OrchestratorConfig } from "../../config/schema";
import type { NotesStore } from "../../state/notes-store";
import { normalizeSessionID } from "../../state/session-id";
import { ensureInsideProject } from "./helpers";
import { atomicWriteFileSync } from "../../io/atomic-write";
import { isRecord } from "../../utils/is-record";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

const schema = tool.schema;

/* ------------------------------------------------------------------ */
/*  Graph type definitions                                            */
/* ------------------------------------------------------------------ */

type MemoryObservation = {
  id: string;
  content: string;
  createdAt: string;
  deletedAt: string | null;
};
type MemoryEntity = {
  id: string;
  name: string;
  entityType: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  observations: MemoryObservation[];
};
type MemoryRelation = {
  id: string;
  from: string;
  to: string;
  relationType: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
type MemoryGraph = {
  format: "aegis-knowledge-graph";
  version: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
  entities: MemoryEntity[];
  relations: MemoryRelation[];
};

type GraphPersistMode = "immediate" | "deferred";

type GraphPersistResult =
  | { ok: true; mode: GraphPersistMode; revision: number }
  | { ok: false; reason: string };

/* ------------------------------------------------------------------ */
/*  Think state type                                                  */
/* ------------------------------------------------------------------ */

type ThinkState = {
  thoughtHistoryLength: number;
  branches: Set<string>;
  totalThoughts: number;
};

/* ------------------------------------------------------------------ */
/*  Deps interface                                                    */
/* ------------------------------------------------------------------ */

export interface MemoryToolDeps {
  config: OrchestratorConfig;
  notesStore: NotesStore;
  projectDir: string;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function createMemoryTools(deps: MemoryToolDeps): Record<string, ToolDefinition> {
  const { config, notesStore, projectDir } = deps;

  /* ---------- graph helpers ---------- */

  const buildEmptyGraph = (): MemoryGraph => {
    const now = new Date().toISOString();
    return {
      format: "aegis-knowledge-graph",
      version: 1,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      entities: [],
      relations: [],
    };
  };

  const graphPaths = (): { ok: true; dir: string; file: string } | { ok: false; reason: string } => {
    const resolved = ensureInsideProject(projectDir, config.memory.storage_dir);
    if (!resolved.ok) {
      return { ok: false as const, reason: `memory.storage_dir ${resolved.reason}` };
    }
    return { ok: true as const, dir: resolved.abs, file: join(resolved.abs, "knowledge-graph.json") };
  };

  const GRAPH_DEFER_FLUSH_MS = 45;
  const GRAPH_DEFER_MAX_RETRIES = 3;
  let graphCache: MemoryGraph | null = null;
  let graphDirty = false;
  let graphFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let graphDeferredRetryCount = 0;

  const clearGraphFlushTimer = (): void => {
    if (graphFlushTimer) {
      clearTimeout(graphFlushTimer);
      graphFlushTimer = null;
    }
  };

  const flushGraph = (options?: { pretty?: boolean }): GraphPersistResult => {
    if (!graphDirty || !graphCache) {
      return {
        ok: true,
        mode: "immediate",
        revision: graphCache?.revision ?? 0,
      };
    }

    const paths = graphPaths();
    if (!paths.ok) return paths;

    try {
      mkdirSync(paths.dir, { recursive: true });
      const now = new Date().toISOString();
      graphCache.updatedAt = now;
      graphCache.revision = (graphCache.revision ?? 0) + 1;
      const pretty = options?.pretty !== false;
      const json = pretty ? JSON.stringify(graphCache, null, 2) : JSON.stringify(graphCache);
      atomicWriteFileSync(paths.file, `${json}\n`);
      graphDirty = false;
      graphDeferredRetryCount = 0;
      return {
        ok: true,
        mode: "immediate",
        revision: graphCache.revision,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const scheduleDeferredGraphFlush = (): void => {
    if (graphFlushTimer) {
      return;
    }
    graphFlushTimer = setTimeout(() => {
      graphFlushTimer = null;
      const flushed = flushGraph({ pretty: false });
      if (!flushed.ok && graphDeferredRetryCount < GRAPH_DEFER_MAX_RETRIES) {
        graphDeferredRetryCount += 1;
        scheduleDeferredGraphFlush();
      }
    }, GRAPH_DEFER_FLUSH_MS);
  };

  const readGraph = (): { ok: true; graph: MemoryGraph } | { ok: false; reason: string } => {
    if (graphCache) {
      return { ok: true as const, graph: graphCache };
    }

    const paths = graphPaths();
    if (!paths.ok) return paths;
    try {
      if (!existsSync(paths.file)) {
        graphCache = buildEmptyGraph();
        return { ok: true as const, graph: graphCache };
      }
      const raw = readFileSync(paths.file, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || parsed.format !== "aegis-knowledge-graph") {
        return { ok: false as const, reason: "invalid knowledge-graph format" };
      }
      const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
      const relations = Array.isArray(parsed.relations) ? parsed.relations : [];
      const graph: MemoryGraph = {
        format: "aegis-knowledge-graph",
        version: 1,
        revision: typeof parsed.revision === "number" ? parsed.revision : 0,
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
        entities: entities as MemoryEntity[],
        relations: relations as MemoryRelation[],
      };
      graphCache = graph;
      return { ok: true as const, graph: graphCache };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  const writeGraph = (
    graph: MemoryGraph,
    options: { defer?: boolean; pretty?: boolean } = {}
  ): GraphPersistResult => {
    graphCache = graph;

    if (options.defer) {
      graphDirty = true;
      scheduleDeferredGraphFlush();
      return {
        ok: true,
        mode: "deferred",
        revision: graph.revision,
      };
    }

    clearGraphFlushTimer();
    graphDirty = true;
    return flushGraph({ pretty: options.pretty });
  };

  /* ---------- think helpers ---------- */

  const thinkStateBySession = new Map<string, ThinkState>();
  const ensureThinkState = (sessionID: string): ThinkState => {
    const existing = thinkStateBySession.get(sessionID);
    if (existing) return existing;
    const created: ThinkState = { thoughtHistoryLength: 0, branches: new Set<string>(), totalThoughts: 1 };
    thinkStateBySession.set(sessionID, created);
    return created;
  };

  const appendThinkRecord = (sessionID: string, payload: Record<string, unknown>): { ok: true } | { ok: false; reason: string } => {
    try {
      const root = notesStore.getRootDirectory();
      const dir = join(root, "thinking");
      const safeSessionID = normalizeSessionID(sessionID);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${safeSessionID}.jsonl`);
      const line = `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`;
      appendFileSync(file, line, "utf-8");
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, reason: message };
    }
  };

  /* ---------- tool definitions ---------- */

  return {
    aegis_memory_save: tool({
      description: "Persist structured memory entities/relations to the local knowledge graph",
      args: {
        entities: schema
          .array(
            schema.object({
              name: schema.string().min(1),
              entityType: schema.string().min(1),
              observations: schema.array(schema.string().min(1)).optional(),
              tags: schema.array(schema.string().min(1)).optional(),
            }),
          )
          .default([]),
        relations: schema
          .array(
            schema.object({
              from: schema.string().min(1),
              to: schema.string().min(1),
              relationType: schema.string().min(1),
              tags: schema.array(schema.string().min(1)).optional(),
            }),
          )
          .default([]),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        if (!config.memory.enabled) {
          return JSON.stringify({ ok: false, reason: "memory disabled", sessionID }, null, 2);
        }
        const loaded = readGraph();
        if (!loaded.ok) {
          return JSON.stringify({ ok: false, reason: loaded.reason, sessionID }, null, 2);
        }
        const graph = loaded.graph;
        const now = new Date().toISOString();

        const createdEntities: string[] = [];
        const updatedEntities: string[] = [];
        for (const e of args.entities ?? []) {
          const name = e.name.trim();
          const entityType = e.entityType.trim();
          if (!name || !entityType) continue;
          const tags = Array.isArray(e.tags) ? e.tags.map((t) => t.trim()).filter(Boolean) : [];
          const obs = Array.isArray(e.observations) ? e.observations.map((o) => o.trim()).filter(Boolean) : [];

          let entity = graph.entities.find((x) => x.name === name);
          if (!entity) {
            entity = {
              id: `ent_${randomUUID()}`,
              name,
              entityType,
              tags,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              observations: [],
            };
            graph.entities.push(entity);
            createdEntities.push(name);
          } else {
            entity.entityType = entityType;
            entity.updatedAt = now;
            entity.deletedAt = null;
            entity.tags = [...new Set([...entity.tags, ...tags])];
            updatedEntities.push(name);
          }

          for (const content of obs) {
            const exists = entity.observations.some((o) => o.deletedAt === null && o.content === content);
            if (exists) continue;
            entity.observations.push({ id: `obs_${randomUUID()}`, content, createdAt: now, deletedAt: null });
            entity.updatedAt = now;
          }
        }

        const createdRelations: string[] = [];
        for (const r of args.relations ?? []) {
          const from = r.from.trim();
          const to = r.to.trim();
          const relationType = r.relationType.trim();
          if (!from || !to || !relationType) continue;
          const tags = Array.isArray(r.tags) ? r.tags.map((t) => t.trim()).filter(Boolean) : [];
          const exists = graph.relations.some(
            (x) => x.deletedAt === null && x.from === from && x.to === to && x.relationType === relationType,
          );
          if (exists) continue;
          graph.relations.push({
            id: `rel_${randomUUID()}`,
            from,
            to,
            relationType,
            tags,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
          createdRelations.push(`${from} ${relationType} ${to}`);
        }

        const persisted = writeGraph(graph, { pretty: true });
        if (!persisted.ok) {
          return JSON.stringify({ ok: false, reason: persisted.reason, sessionID }, null, 2);
        }
        return JSON.stringify(
          {
            ok: true,
            sessionID,
            storageDir: config.memory.storage_dir,
            createdEntities,
            updatedEntities,
            createdRelations,
            persisted: {
              mode: persisted.mode,
              revision: persisted.revision,
            },
          },
          null,
          2,
        );
      },
    }),

    aegis_memory_search: tool({
      description: "Search the local knowledge graph for a query string",
      args: {
        query: schema.string().min(1),
        limit: schema.number().int().positive().max(100).default(20),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        if (!config.memory.enabled) {
          return JSON.stringify({ ok: false, reason: "memory disabled", sessionID }, null, 2);
        }
        const loaded = readGraph();
        if (!loaded.ok) {
          return JSON.stringify({ ok: false, reason: loaded.reason, sessionID }, null, 2);
        }
        const q = args.query.toLowerCase();
        const results: Array<{ id: string; name: string; entityType: string; match: string }> = [];
        for (const e of loaded.graph.entities) {
          if (e.deletedAt) continue;
          const nameHit = e.name.toLowerCase().includes(q);
          const typeHit = e.entityType.toLowerCase().includes(q);
          const obsHit = e.observations.find((o) => o.deletedAt == null && o.content.toLowerCase().includes(q));
          if (!nameHit && !typeHit && !obsHit) continue;
          const match = nameHit ? "name" : typeHit ? "entityType" : "observation";
          results.push({ id: e.id, name: e.name, entityType: e.entityType, match });
          if (results.length >= args.limit) break;
        }
        return JSON.stringify({ ok: true, sessionID, query: args.query, results }, null, 2);
      },
    }),

    aegis_memory_list: tool({
      description: "List entities in the local knowledge graph",
      args: {
        limit: schema.number().int().positive().max(200).default(50),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        if (!config.memory.enabled) {
          return JSON.stringify({ ok: false, reason: "memory disabled", sessionID }, null, 2);
        }
        const loaded = readGraph();
        if (!loaded.ok) {
          return JSON.stringify({ ok: false, reason: loaded.reason, sessionID }, null, 2);
        }
        const entities = loaded.graph.entities
          .filter((e) => !e.deletedAt)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, args.limit)
          .map((e) => ({
            id: e.id,
            name: e.name,
            entityType: e.entityType,
            tags: e.tags,
            updatedAt: e.updatedAt,
            observations: e.observations.filter((o) => o.deletedAt === null).length,
          }));
        return JSON.stringify({ ok: true, sessionID, entities }, null, 2);
      },
    }),

    aegis_memory_delete: tool({
      description: "Delete entities by name (soft delete by default)",
      args: {
        names: schema.array(schema.string().min(1)).default([]),
        hard_delete: schema.boolean().default(false),
      },
      execute: async (args, context) => {
        const startedAt = process.hrtime.bigint();
        const sessionID = context.sessionID;
        if (!config.memory.enabled) {
          return JSON.stringify({ ok: false, reason: "memory disabled", sessionID }, null, 2);
        }
        const loaded = readGraph();
        if (!loaded.ok) {
          return JSON.stringify({ ok: false, reason: loaded.reason, sessionID }, null, 2);
        }
        const graph = loaded.graph;
        const now = new Date().toISOString();
        const targets = new Set(args.names.map((n) => n.trim()).filter(Boolean));
        if (targets.size === 0) {
          return JSON.stringify(
            {
              ok: true,
              sessionID,
              deleted: 0,
              deletedRelations: 0,
              persisted: null,
              latency_ms: Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3)),
            },
            null,
            2
          );
        }

        let deleted = 0;
        let deletedRelations = 0;
        if (args.hard_delete) {
          const removedNames = new Set<string>();
          const before = graph.entities.length;
          graph.entities = graph.entities.filter((e) => {
            const keep = !targets.has(e.name);
            if (!keep) {
              removedNames.add(e.name);
            }
            return keep;
          });
          deleted = before - graph.entities.length;
          if (removedNames.size > 0) {
            const beforeRelations = graph.relations.length;
            graph.relations = graph.relations.filter(
              (relation) => !removedNames.has(relation.from) && !removedNames.has(relation.to)
            );
            deletedRelations = beforeRelations - graph.relations.length;
          }
        } else {
          for (const e of graph.entities) {
            if (!targets.has(e.name)) continue;
            if (e.deletedAt) continue;
            e.deletedAt = now;
            e.updatedAt = now;
            deleted += 1;
          }
          if (deleted > 0) {
            for (const relation of graph.relations) {
              if (relation.deletedAt) continue;
              if (!targets.has(relation.from) && !targets.has(relation.to)) continue;
              relation.deletedAt = now;
              relation.updatedAt = now;
              deletedRelations += 1;
            }
          }
        }

        if (deleted === 0 && deletedRelations === 0) {
          return JSON.stringify(
            {
              ok: true,
              sessionID,
              deleted,
              deletedRelations,
              persisted: null,
              latency_ms: Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3)),
            },
            null,
            2
          );
        }

        const persisted = writeGraph(graph, {
          defer: !args.hard_delete,
          pretty: false,
        });
        if (!persisted.ok) {
          return JSON.stringify({ ok: false, reason: persisted.reason, sessionID }, null, 2);
        }

        const latencyMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
        return JSON.stringify(
          {
            ok: true,
            sessionID,
            deleted,
            deletedRelations,
            persisted: {
              mode: persisted.mode,
              revision: persisted.revision,
            },
            latency_ms: latencyMs,
          },
          null,
          2
        );
      },
    }),

    aegis_think: tool({
      description: "Record structured step-by-step reasoning to durable notes",
      args: {
        thought: schema.string().min(1),
        nextThoughtNeeded: schema.boolean(),
        thoughtNumber: schema.number().int().min(1),
        totalThoughts: schema.number().int().min(1),
        isRevision: schema.boolean().optional(),
        revisesThought: schema.number().int().min(1).optional(),
        branchFromThought: schema.number().int().min(1).optional(),
        branchId: schema.string().min(1).optional(),
        needsMoreThoughts: schema.boolean().optional(),
        session_id: schema.string().optional(),
      },
      execute: async (args, context) => {
        const sessionID = args.session_id ?? context.sessionID;
        if (!config.sequential_thinking.enabled) {
          return JSON.stringify({ ok: false, reason: "sequential thinking disabled", sessionID }, null, 2);
        }
        const state = ensureThinkState(sessionID);
        const adjustedTotal = Math.max(state.totalThoughts, args.totalThoughts, args.thoughtNumber);
        state.totalThoughts = adjustedTotal;
        state.thoughtHistoryLength += 1;
        if (args.branchId && typeof args.branchFromThought === "number") {
          state.branches.add(args.branchId);
        }
        const recorded = appendThinkRecord(sessionID, {
          tool: config.sequential_thinking.tool_name,
          thought: args.thought,
          nextThoughtNeeded: args.nextThoughtNeeded,
          thoughtNumber: args.thoughtNumber,
          totalThoughts: adjustedTotal,
          isRevision: args.isRevision ?? false,
          revisesThought: args.revisesThought ?? null,
          branchFromThought: args.branchFromThought ?? null,
          branchId: args.branchId ?? null,
          needsMoreThoughts: args.needsMoreThoughts ?? null,
        });
        if (!recorded.ok) {
          return JSON.stringify({ ok: false, reason: recorded.reason, sessionID }, null, 2);
        }
        return JSON.stringify(
          {
            thoughtNumber: args.thoughtNumber,
            totalThoughts: adjustedTotal,
            nextThoughtNeeded: args.nextThoughtNeeded,
            branches: [...state.branches],
            thoughtHistoryLength: state.thoughtHistoryLength,
          },
          null,
          2,
        );
      },
    }),
  };
}
