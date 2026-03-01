import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { maybeNpmAutoUpdatePackage, resolveOpencodeCacheDir } from "../src/install/npm-auto-update";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function makeRoot(): string {
  const root = join(tmpdir(), `aegis-npm-auto-update-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  return root;
}

describe("npm auto-update", () => {
  it("resolves OpenCode cache dir from XDG cache home", () => {
    const dir = resolveOpencodeCacheDir({
      XDG_CACHE_HOME: "/tmp/xdg-cache",
      HOME: "/tmp/home",
    } as NodeJS.ProcessEnv);

    expect(dir).toBe(resolve("/tmp/xdg-cache/opencode"));
  });

  it("resolves OpenCode cache dir from HOME when XDG cache home is missing", () => {
    const dir = resolveOpencodeCacheDir({
      HOME: "/tmp/home",
    } as NodeJS.ProcessEnv);

    expect(dir).toBe(resolve("/tmp/home/.cache/opencode"));
  });

  it("resolves OpenCode cache dir using LOCALAPPDATA on Windows", () => {
    const dir = resolveOpencodeCacheDir({
      OS: "Windows_NT",
      LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
      APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
    } as NodeJS.ProcessEnv);

    expect(dir).toBe(resolve("C:\\Users\\tester\\AppData\\Local/opencode"));
  });

  it("updates when latest differs", async () => {
    const root = makeRoot();
    mkdirSync(join(root, "node_modules", "oh-my-aegis"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{}\n", "utf-8");
    writeFileSync(join(root, "node_modules", "oh-my-aegis", "package.json"), JSON.stringify({ version: "0.1.0" }), "utf-8");

    const res = await maybeNpmAutoUpdatePackage({
      packageName: "oh-my-aegis",
      installDir: root,
      currentVersion: "0.1.0",
      force: true,
      silent: true,
      deps: {
        resolveLatest: async () => "0.2.0",
        runImpl: (_cmd, args, cwd) => {
          if (args[0] === "install" && cwd === root) {
            writeFileSync(
              join(root, "node_modules", "oh-my-aegis", "package.json"),
              JSON.stringify({ version: "0.2.0" }),
              "utf-8"
            );
            return { ok: true, stdout: "", stderr: "" };
          }
          return { ok: true, stdout: "", stderr: "" };
        },
        nowImpl: () => 1234,
      },
    });

    expect(res.status).toBe("updated");
    expect(res.latestVersion).toBe("0.2.0");
    expect(res.localVersion).toBe("0.2.0");
  });
});
