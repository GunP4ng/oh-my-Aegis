import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInstall } from "../src/cli/install";

const roots: string[] = [];
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function makeRoot(): string {
  const root = join(tmpdir(), `aegis-cli-install-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  return root;
}

function captureWrites(run: () => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
    return true;
  }) as typeof process.stderr.write;

  return run()
    .then((code) => ({ code, stdout, stderr }))
    .finally(() => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    });
}

describe("cli install", () => {
  it("ensures oh-my-aegis@latest without config-dir npm install side effects or runtime-update messaging", async () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });

    const opencodePath = join(opencodeDir, "opencode.json");
    writeFileSync(opencodePath, `${JSON.stringify({ plugin: ["existing-plugin"] }, null, 2)}\n`, "utf-8");

    const configDirPackagePath = join(opencodeDir, "package.json");
    const originalConfigDirPackage = `${JSON.stringify({ name: "opencode-config-dir", dependencies: {} }, null, 2)}\n`;
    writeFileSync(configDirPackagePath, originalConfigDirPackage, "utf-8");

    process.env = {
      ...originalEnv,
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    };

    const { code, stdout, stderr } = await captureWrites(() => runInstall(["--no-tui", "--chatgpt=no"]));
    expect(code).toBe(0);
    expect(stderr).toBe("");

    const installedOpencode = JSON.parse(readFileSync(opencodePath, "utf-8")) as {
      plugin?: unknown;
    };
    const plugins = Array.isArray(installedOpencode.plugin) ? installedOpencode.plugin : [];
    expect(plugins).toContain("oh-my-aegis@latest");

    expect(stdout).toContain("- plugin entry ensured: oh-my-aegis@latest");
    expect(stdout).not.toContain("OpenCode plugin updated");
    expect(stdout).not.toContain("npm install");

    const configDirPackageAfter = readFileSync(configDirPackagePath, "utf-8");
    expect(configDirPackageAfter).toBe(originalConfigDirPackage);
  });
});
