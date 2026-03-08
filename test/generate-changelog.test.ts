import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function runChangelog(env: Record<string, string | undefined> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "scripts/generate-changelog.ts"],
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("generate changelog script", () => {
  it("uses explicit release ref and base tag overrides", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { version: string };
    const proc = runChangelog({
      AEGIS_RELEASE_REF: "HEAD",
      AEGIS_RELEASE_BASE_TAG: "v0.2.22",
    });
    const output = Buffer.from(proc.stdout).toString("utf-8");

    expect(proc.exitCode).toBe(0);
    expect(output).toContain(`# Release v${pkg.version}`);
    expect(output).toContain("Release ref: HEAD");
    expect(output).toContain("Base tag: v0.2.22");
  });

  it("fails fast for an unknown release ref", () => {
    const proc = runChangelog({
      AEGIS_RELEASE_REF: "refs/heads/does-not-exist",
    });
    const stderr = Buffer.from(proc.stderr).toString("utf-8");

    expect(proc.exitCode).not.toBe(0);
    expect(stderr).toContain("Unknown release ref");
  });
});
