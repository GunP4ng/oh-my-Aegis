import { tool, type ToolDefinition } from "@opencode-ai/plugin";

const schema = tool.schema;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasError(result: unknown): boolean {
  if (!isRecord(result)) return false;
  return Boolean(result.error);
}

function extractLspApi(client: unknown): Record<string, unknown> | null {
  const lsp = (client as { lsp?: unknown } | null)?.lsp as unknown;
  if (!lsp || typeof lsp !== "object") return null;
  return lsp as Record<string, unknown>;
}

async function callLspOperation(
  client: unknown,
  op: string,
  directory: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; reason: string }> {
  const api = extractLspApi(client);
  const fn = api ? (api as Record<string, unknown>)[op] : undefined;
  if (typeof fn !== "function") {
    return { ok: false as const, reason: "client.lsp operation unavailable" };
  }
  try {
    const primary = await (fn as (x: unknown) => Promise<any>)({ query: { directory, ...args } });
    if (!hasError(primary)) {
      return { ok: true as const, data: primary?.data ?? primary };
    }
  } catch (error) {
    void error;
  }

  try {
    const fallback = await (fn as (x: unknown) => Promise<any>)({ directory, ...args });
    if (!hasError(fallback)) {
      return { ok: true as const, data: fallback?.data ?? fallback };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false as const, reason: message };
  }
  return { ok: false as const, reason: "unexpected lsp response" };
}

export function createLspTools(params: { client: unknown; projectDir: string }): Record<string, ToolDefinition> {
  const directory = params.projectDir;

  return {
    ctf_lsp_goto_definition: tool({
      description: "LSP: go to definition",
      args: {
        filePath: schema.string().min(1),
        line: schema.number().int().min(1),
        character: schema.number().int().min(0),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        const result = await callLspOperation(params.client, "goToDefinition", directory, {
          filePath: args.filePath,
          line: args.line,
          character: args.character,
        });
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_lsp_find_references: tool({
      description: "LSP: find references",
      args: {
        filePath: schema.string().min(1),
        line: schema.number().int().min(1),
        character: schema.number().int().min(0),
        includeDeclaration: schema.boolean().optional(),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        const result = await callLspOperation(params.client, "findReferences", directory, {
          filePath: args.filePath,
          line: args.line,
          character: args.character,
          includeDeclaration: args.includeDeclaration,
        });
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),

    ctf_lsp_diagnostics: tool({
      description: "LSP: diagnostics for a file",
      args: {
        filePath: schema.string().min(1),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        const result = await callLspOperation(params.client, "diagnostics", directory, {
          filePath: args.filePath,
        });
        return JSON.stringify({ sessionID, ...result }, null, 2);
      },
    }),
  };
}
