import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findGitRepoRoot, isAutoUpdateEnabled, maybeAutoUpdate } from "../src/cli/update";

const roots: string[] = [];
const originalAutoUpdate = process.env.AEGIS_AUTO_UPDATE;

afterEach(() => {
  if (typeof originalAutoUpdate === "string") {
    process.env.AEGIS_AUTO_UPDATE = originalAutoUpdate;
  } else {
    delete process.env.AEGIS_AUTO_UPDATE;
  }
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function makeRoot(): string {
  const root = join(tmpdir(), `aegis-cli-update-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  return root;
}

describe("cli update helpers", () => {
  it("parses auto-update env toggle", () => {
    delete process.env.AEGIS_AUTO_UPDATE;
    expect(isAutoUpdateEnabled()).toBe(true);

    process.env.AEGIS_AUTO_UPDATE = "0";
    expect(isAutoUpdateEnabled()).toBe(false);

    process.env.AEGIS_AUTO_UPDATE = "false";
    expect(isAutoUpdateEnabled()).toBe(false);

    process.env.AEGIS_AUTO_UPDATE = "yes";
    expect(isAutoUpdateEnabled()).toBe(true);
  });

  it("finds git repo root by walking parents", () => {
    const root = makeRoot();
    const nested = join(root, "a", "b", "c");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    expect(findGitRepoRoot(nested)).toBe(root);
  });

  it("respects stopDir boundary and does not walk above module root", () => {
    const root = makeRoot();
    const moduleRoot = join(root, "node_modules", "oh-my-aegis");
    const nested = join(moduleRoot, "dist", "cli");

    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    expect(findGitRepoRoot(nested, moduleRoot)).toBeNull();
  });

  it("returns disabled status when env toggle is off", async () => {
    process.env.AEGIS_AUTO_UPDATE = "off";
    const result = await maybeAutoUpdate({ force: true, silent: true });
    expect(result.status).toBe("disabled");
  });
});
