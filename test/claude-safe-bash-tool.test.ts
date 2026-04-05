import { describe, expect, it } from "bun:test";

import { resolveAegisBashInvocation } from "../src/tools/claude-safe-bash-tool";

describe("aegis bash invocation", () => {
  it("uses bash from PATH on Windows", () => {
    expect(resolveAegisBashInvocation("printf 'ok'", { platform: "win32", hasAbsoluteBash: false })).toEqual({
      command: "bash",
      args: ["-lc", "printf 'ok'"],
    });
  });

  it("preserves absolute bash on Unix when available", () => {
    expect(resolveAegisBashInvocation("printf 'ok'", { platform: "linux", hasAbsoluteBash: true })).toEqual({
      command: "/bin/bash",
      args: ["-lc", "printf 'ok'"],
    });
  });
});
