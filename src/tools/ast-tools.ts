import { tool, type ToolDefinition } from "@opencode-ai/plugin";

const schema = tool.schema;

type Mode = "CTF" | "BOUNTY";

type SgRunArgs = {
  pattern: string;
  rewrite?: string;
  lang?: string;
  paths?: string[];
  globs?: string[];
  selector?: string;
  strictness?: "cst" | "smart" | "ast" | "relaxed" | "signature" | "template";
  context?: number;
  output?: "text" | "json";
};

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
  const cmd: string[] = [
    "npx",
    "-y",
    "-p",
    "@ast-grep/cli",
    "sg",
    "run",
    "--color",
    "never",
    "--heading",
    "never",
    "--pattern",
    params.args.pattern,
  ];

  if (params.args.lang && params.args.lang.trim().length > 0) {
    cmd.push("--lang", params.args.lang.trim());
  }
  if (params.args.selector && params.args.selector.trim().length > 0) {
    cmd.push("--selector", params.args.selector.trim());
  }
  if (params.args.strictness) {
    cmd.push("--strictness", params.args.strictness);
  }
  if (typeof params.args.context === "number" && Number.isFinite(params.args.context) && params.args.context > 0) {
    cmd.push("--context", String(Math.floor(params.args.context)));
  }
  if (params.args.output === "json") {
    cmd.push("--json=compact");
  }

  if (params.args.globs && params.args.globs.length > 0) {
    for (const g of params.args.globs) {
      if (typeof g === "string" && g.trim().length > 0) {
        cmd.push("--globs", g.trim());
      }
    }
  }

  if (params.args.rewrite !== undefined) {
    cmd.push("--rewrite", params.args.rewrite);
  }

  cmd.push(...paths);

  const child = Bun.spawn({
    cmd,
    cwd: params.directory,
    env: {
      ...process.env,
      CI: "true",
      NO_COLOR: "1",
      TERM: "dumb",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const killer = () => {
    try {
      child.kill();
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

  const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer().then((b) => new Uint8Array(b)),
    new Response(child.stderr).arrayBuffer().then((b) => new Uint8Array(b)),
    child.exited,
  ]);

  clearTimeout(timeout);
  if (params.abort && !params.abort.aborted) {
    params.abort.removeEventListener("abort", abortListener);
  }

  const stdout = new TextDecoder().decode(stdoutBytes);
  const stderr = new TextDecoder().decode(stderrBytes);
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
      description: "AST-grep: search code by AST pattern (uses npx -p @ast-grep/cli)",
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
        const result = await runSg({
          directory,
          timeoutMs,
          abort: context.abort,
          args: {
            pattern: args.pattern,
            lang: args.lang,
            paths: args.paths,
            globs: args.globs,
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

        const result = await runSg({
          directory,
          timeoutMs,
          abort: context.abort,
          args: {
            pattern: args.pattern,
            rewrite: args.rewrite,
            lang: args.lang,
            paths: args.paths,
            globs: args.globs,
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
            ok: apply ? result.ok : true,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            command: result.command,
            stdout: out.text,
            stderr: err.text,
            stdoutTruncated: out.truncated,
            stderrTruncated: err.truncated,
            note: apply
              ? "Rewrite requested. sg run does not apply changes unless you use --update-all/interactive; this tool intentionally avoids those flags."
              : "Dry-run only. No files were modified.",
          },
          null,
          2,
        );
      },
    }),
  };
}
