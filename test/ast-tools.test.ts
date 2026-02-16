import { describe, expect, it } from "bun:test";
import { buildSgRunCommand, createAstGrepTools } from "../src/tools/ast-tools";

describe("ast-tools", () => {
  it("buildSgRunCommand adds --update-all when applying rewrites", () => {
    const cmd = buildSgRunCommand({
      pattern: "console.log($MSG)",
      rewrite: "logger.info($MSG)",
      updateAll: true,
      lang: "ts",
      paths: ["src"],
    });

    expect(cmd).toContain("--rewrite");
    expect(cmd).toContain("--update-all");
    expect(cmd).toContain("--pattern");
  });

  it("ctf_ast_grep_search rejects paths outside projectDir", async () => {
    const tools = createAstGrepTools({
      projectDir: "/tmp/aegis-project",
      getMode: () => "CTF",
    });

    const raw = await tools.ctf_ast_grep_search.execute(
      { pattern: "let $X = $Y", paths: ["../"] },
      { sessionID: "s1", abort: new AbortController().signal } as never,
    );
    const parsed = JSON.parse(raw) as { ok: boolean; reason?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toContain("inside projectDir");
  });

  it("ctf_ast_grep_search rejects absolute globs", async () => {
    const tools = createAstGrepTools({
      projectDir: "/tmp/aegis-project",
      getMode: () => "CTF",
    });

    const raw = await tools.ctf_ast_grep_search.execute(
      { pattern: "let $X = $Y", globs: ["/etc/*"] },
      { sessionID: "s2", abort: new AbortController().signal } as never,
    );
    const parsed = JSON.parse(raw) as { ok: boolean; reason?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toContain("project-relative");
  });
});
