import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";

const schema = tool.schema;

type Mode = "CTF" | "BOUNTY";

type SgRunArgs = {
  pattern: string;
  rewrite?: string;
  updateAll?: boolean;
  lang?: string;
  paths?: string[];
  globs?: string[];
  selector?: string;
  strictness?: "cst" | "smart" | "ast" | "relaxed" | "signature" | "template";
  context?: number;
  output?: "text" | "json";
};

function isInsideRoot(root: string, candidatePath: string): boolean {
  const rootAbs = resolve(root);
  const targetAbs = resolve(candidatePath);
  const rel = relative(rootAbs, targetAbs);
  if (!rel) return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function validateSearchPaths(projectDir: string, paths: string[]): { ok: true; paths: string[] } | { ok: false; reason: string } {
  const normalized: string[] = [];
  for (const raw of paths) {
    const p = raw.trim();
    if (!p) continue;
    const abs = isAbsolute(p) ? p : resolve(projectDir, p);
    if (!isInsideRoot(projectDir, abs)) {
      return { ok: false as const, reason: `path must be inside projectDir: ${p}` };
    }
    normalized.push(p);
  }
  if (normalized.length === 0) {
    return { ok: true as const, paths: ["."] };
  }
  return { ok: true as const, paths: normalized };
}

function validateGlobs(globs: string[] | undefined): { ok: true; globs: string[] } | { ok: false; reason: string } {
  const normalized: string[] = [];
  for (const raw of globs ?? []) {
    const g = raw.trim();
    if (!g) continue;
    if (g.startsWith("/") || g.startsWith("~") || g.startsWith("..")) {
      return { ok: false as const, reason: `glob must be project-relative: ${g}` };
    }
    normalized.push(g);
  }
  return { ok: true as const, globs: normalized };
}

export function buildSgRunCommand(args: {
  pattern: string;
  rewrite?: string;
  updateAll?: boolean;
  lang?: string;
  selector?: string;
  strictness?: SgRunArgs["strictness"];
  context?: number;
  output?: SgRunArgs["output"];
  globs?: string[];
  paths: string[];
}): string[] {
  const cmd: string[] = [
    "bun",
    "x",
    "sg",
    "run",
    "--color",
    "never",
    "--heading",
    "never",
    "--pattern",
    args.pattern,
  ];

  if (args.lang && args.lang.trim().length > 0) {
    cmd.push("--lang", args.lang.trim());
  }
  if (args.selector && args.selector.trim().length > 0) {
    cmd.push("--selector", args.selector.trim());
  }
  if (args.strictness) {
    cmd.push("--strictness", args.strictness);
  }
  if (typeof args.context === "number" && Number.isFinite(args.context) && args.context > 0) {
    cmd.push("--context", String(Math.floor(args.context)));
  }

  const globs = Array.isArray(args.globs) ? args.globs : [];
  for (const g of globs) {
    if (typeof g === "string" && g.trim().length > 0) {
      cmd.push("--globs", g.trim());
    }
  }

  if (args.rewrite !== undefined) {
    cmd.push("--rewrite", args.rewrite);
    if (args.updateAll) {
      cmd.push("--update-all");
    }
  }

  if (args.output === "json") {
    cmd.push("--json=compact");
  }

  cmd.push(...args.paths);

  return cmd;
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

async function runSg(params: {
  directory: string;
  args: SgRunArgs;
  timeoutMs: number;
  abort: AbortSignal;
}): Promise<{
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string[];
  timedOut: boolean;
}> {
  const paths = params.args.paths && params.args.paths.length > 0 ? params.args.paths : ["."];
  const cmd = buildSgRunCommand({
    pattern: params.args.pattern,
    rewrite: params.args.rewrite,
    updateAll: params.args.updateAll,
    lang: params.args.lang,
    selector: params.args.selector,
    strictness: params.args.strictness,
    context: params.args.context,
    output: params.args.output,
    globs: params.args.globs,
    paths,
  });

  const child = spawn(cmd[0] as string, cmd.slice(1), {
    cwd: params.directory,
    env: {
      ...process.env,
      CI: "true",
      NO_COLOR: "1",
      TERM: "dumb",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let timedOut = false;
  const killer = () => {
    try {
      if (!child.killed) {
        child.kill();
      }
    } catch {
    }
  };

  const timeout = setTimeout(() => {
    timedOut = true;
    killer();
  }, Math.max(100, params.timeoutMs));

  const abortListener = () => {
    killer();
  };
  if (params.abort) {
    if (params.abort.aborted) {
      killer();
    } else {
      params.abort.addEventListener("abort", abortListener, { once: true });
    }
  }

  const collect = async (stream: NodeJS.ReadableStream | null): Promise<Buffer> => {
    if (!stream) return Buffer.from("");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  };

  const exited = new Promise<number>((resolveExit) => {
    child.once("close", (code) => {
      resolveExit(typeof code === "number" ? code : 1);
    });
  });

  const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
    collect(child.stdout),
    collect(child.stderr),
    exited,
  ]);

  clearTimeout(timeout);
  if (params.abort && !params.abort.aborted) {
    params.abort.removeEventListener("abort", abortListener);
  }

  const stdout = stdoutBytes.toString("utf-8");
  const stderr = stderrBytes.toString("utf-8");
  return { ok: exitCode === 0, exitCode, stdout, stderr, command: cmd, timedOut };
}

export function createAstGrepTools(params: {
  projectDir: string;
  getMode: (sessionID: string) => Mode;
  timeoutMs?: number;
}): Record<string, ToolDefinition> {
  const directory = params.projectDir;
  const timeoutMs = typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) ? params.timeoutMs : 30_000;
  const MAX_OUT = 12_000;

  return {
    ctf_ast_grep_search: tool({
      description: "AST-grep: search code by AST pattern (uses bun x sg)",
      args: {
        pattern: schema.string().min(1),
        lang: schema.string().optional(),
        paths: schema.array(schema.string().min(1)).optional(),
        globs: schema.array(schema.string().min(1)).optional(),
        selector: schema.string().optional(),
        strictness: schema.enum(["cst", "smart", "ast", "relaxed", "signature", "template"]).optional(),
        context: schema.number().int().min(0).max(50).optional(),
        output: schema.enum(["text", "json"]).optional(),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        const validatedPaths = validateSearchPaths(directory, args.paths ?? ["."]);
        if (!validatedPaths.ok) {
          return JSON.stringify({ sessionID, ok: false, reason: validatedPaths.reason }, null, 2);
        }
        const validatedGlobs = validateGlobs(args.globs);
        if (!validatedGlobs.ok) {
          return JSON.stringify({ sessionID, ok: false, reason: validatedGlobs.reason }, null, 2);
        }
        const result = await runSg({
          directory,
          timeoutMs,
          abort: context.abort,
          args: {
            pattern: args.pattern,
            lang: args.lang,
            paths: validatedPaths.paths,
            globs: validatedGlobs.globs,
            selector: args.selector,
            strictness: args.strictness,
            context: args.context,
            output: args.output,
          },
        });
        const out = truncate(result.stdout, MAX_OUT);
        const err = truncate(result.stderr, MAX_OUT);
        return JSON.stringify(
          {
            sessionID,
            ok: result.ok,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            command: result.command,
            stdout: out.text,
            stderr: err.text,
            stdoutTruncated: out.truncated,
            stderrTruncated: err.truncated,
          },
          null,
          2,
        );
      },
    }),

    ctf_ast_grep_replace: tool({
      description: "AST-grep: rewrite code by AST pattern (defaults to dry-run)",
      args: {
        pattern: schema.string().min(1),
        rewrite: schema.string().min(0),
        lang: schema.string().optional(),
        paths: schema.array(schema.string().min(1)).optional(),
        globs: schema.array(schema.string().min(1)).optional(),
        selector: schema.string().optional(),
        strictness: schema.enum(["cst", "smart", "ast", "relaxed", "signature", "template"]).optional(),
        context: schema.number().int().min(0).max(50).optional(),
        apply: schema.boolean().optional(),
        output: schema.enum(["text", "json"]).optional(),
      },
      execute: async (args, context) => {
        const sessionID = context.sessionID;
        const mode = params.getMode(sessionID);
        const apply = Boolean(args.apply);
        if (apply && mode === "BOUNTY") {
          return JSON.stringify(
            {
              sessionID,
              ok: false,
              reason: "Refusing to apply AST rewrite in BOUNTY mode. Run with apply=false for dry-run output.",
            },
            null,
            2,
          );
        }

        const validatedPaths = validateSearchPaths(directory, args.paths ?? ["."]);
        if (!validatedPaths.ok) {
          return JSON.stringify({ sessionID, ok: false, reason: validatedPaths.reason }, null, 2);
        }
        const validatedGlobs = validateGlobs(args.globs);
        if (!validatedGlobs.ok) {
          return JSON.stringify({ sessionID, ok: false, reason: validatedGlobs.reason }, null, 2);
        }

        const result = await runSg({
          directory,
          timeoutMs,
          abort: context.abort,
          args: {
            pattern: args.pattern,
            rewrite: args.rewrite,
            updateAll: apply,
            lang: args.lang,
            paths: validatedPaths.paths,
            globs: validatedGlobs.globs,
            selector: args.selector,
            strictness: args.strictness,
            context: args.context,
            output: args.output,
          },
        });

        const out = truncate(result.stdout, MAX_OUT);
        const err = truncate(result.stderr, MAX_OUT);
        return JSON.stringify(
          {
            sessionID,
            mode,
            apply,
            ok: result.ok,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            command: result.command,
            stdout: out.text,
            stderr: err.text,
            stdoutTruncated: out.truncated,
            stderrTruncated: err.truncated,
            note: apply ? "Applied rewrite with --update-all." : "Dry-run only. No files were modified.",
          },
          null,
          2,
        );
      },
    }),
  };
}
