import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { maybeNpmAutoUpdatePackage } from "../src/install/npm-auto-update";

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
