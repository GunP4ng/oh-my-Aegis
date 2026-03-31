import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrchestratorConfigSchema } from "../src/config/schema";
import { buildReadinessReport } from "../src/config/readiness";
import { NotesStore } from "../src/state/notes-store";
import { requiredDispatchSubagents } from "../src/orchestration/task-dispatch";

const roots: string[] = [];
const originalHome = process.env.HOME;
const originalXdg = process.env.XDG_CONFIG_HOME;
const originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR;

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdg;
  }
  if (originalOpencodeConfigDir === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR;
  } else {
    process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir;
  }
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function setup() {
  const root = join(tmpdir(), `aegis-readiness-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const home = join(root, "home");
  const project = join(root, "project");
  const opencodeDir = join(home, ".config", "opencode");

  mkdirSync(opencodeDir, { recursive: true });
  mkdirSync(project, { recursive: true });
  roots.push(root);
  process.env.HOME = home;

  const config = OrchestratorConfigSchema.parse({});
  const notesStore = new NotesStore(project, config.markdown_budget);
  notesStore.ensureFiles();

  return { root, home, project, opencodeDir, config, notesStore };
}

function writeProvisionedOpencodeConfig(
  opencodeDir: string,
  config = OrchestratorConfigSchema.parse({}),
  pluginEntries?: string[]
) {
  const required = new Set(requiredDispatchSubagents(config));
  required.add(config.failover.map.explore);
  required.add(config.failover.map.librarian);
  required.add(config.failover.map.oracle);

  const agentMap: Record<string, { model: string; variant: string }> = {};
  for (const name of required) {
    agentMap[name] = { model: "test/model", variant: "low" };
  }

  const plugins = pluginEntries ?? [
    "oh-my-aegis@latest",
    "opencode-gemini-auth@1.4.8",
    "opencode-cluade-auth@1.0.1",
    "opencode-openai-codex-auth@latest",
  ];

  writeFileSync(
    join(opencodeDir, "opencode.json"),
    `${JSON.stringify(
      {
        agent: agentMap,
        plugin: plugins,
        mcp: {
          context7: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true },
          grep_app: { type: "remote", url: "https://mcp.grep.app", enabled: true },
          websearch: { type: "remote", url: "https://mcp.exa.ai/mcp", enabled: true },
          memory: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-memory"], enabled: true },
          sequential_thinking: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"], enabled: true },
        },
      },
      null,
      2
    )}\n`,
    "utf-8"
  );
}

function writeGoogleAuth(home: string, auth: Record<string, unknown>) {
  const authDir = join(home, ".local", "share", "opencode");
  mkdirSync(authDir, { recursive: true });
  writeFileSync(join(authDir, "auth.json"), `${JSON.stringify({ google: auth }, null, 2)}\n`, "utf-8");
}

describe("readiness domain coverage", () => {
  it("fails readiness when OpenCode config is missing in strict mode", () => {
    const { project, config, notesStore } = setup();

    const report = buildReadinessReport(project, notesStore, config);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.includes("No OpenCode config file found"))).toBe(true);
  });

  it("downgrades missing config to warning when strict readiness is disabled", () => {
    const { project, notesStore } = setup();
    const relaxedConfig = OrchestratorConfigSchema.parse({ strict_readiness: false });

    const report = buildReadinessReport(project, notesStore, relaxedConfig);
    expect(report.ok).toBe(true);
    expect(report.warnings.some((warning) => warning.includes("No OpenCode config file found"))).toBe(true);
  });

  it("flags missing FORENSICS domain subagents", () => {
    const { opencodeDir, project, config, notesStore } = setup();

    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify({ agent: { "ctf-solve": { model: "x", variant: "y" } } }, null, 2)}\n`,
      "utf-8"
    );

    const report = buildReadinessReport(project, notesStore, config);
    expect(report.ok).toBe(false);
    expect(report.coverageByTarget["CTF:FORENSICS"].missingSubagents).toContain("ctf-forensics");
    expect(report.coverageByTarget["CTF:WEB3"].missingSubagents).toContain("ctf-web3");
    expect(report.missingMcps).toContain("context7");
    expect(report.missingMcps).toContain("grep_app");
    expect(report.missingMcps).toContain("memory");
    expect(report.missingMcps).toContain("sequential_thinking");
  });

  it("passes readiness when required matrix subagents are provisioned and Gemini auth is configured", () => {
    const { home, opencodeDir, project, config, notesStore } = setup();
    writeProvisionedOpencodeConfig(opencodeDir, config);
    writeGoogleAuth(home, {
      type: "oauth",
      refresh: "refresh-token|project-123|managed-project-456",
      access: "access-token",
      expires: Date.now() + 60_000,
    });

    const report = buildReadinessReport(project, notesStore, config);
    expect(report.ok).toBe(true);
    expect(report.missingSubagents.length).toBe(0);
    expect(report.missingMcps.length).toBe(0);
    expect(report.coverageByTarget["CTF:FORENSICS"].missingSubagents.length).toBe(0);
  });

  it("recognizes auth plugins registered with Windows path entries", () => {
    const { home, opencodeDir, project, config, notesStore } = setup();
    writeProvisionedOpencodeConfig(opencodeDir, config, [
      "oh-my-aegis@latest",
      "C:\\Users\\tester\\AppData\\Roaming\\npm\\node_modules\\opencode-gemini-auth\\dist\\index.js",
      "C:\\Users\\tester\\AppData\\Roaming\\npm\\node_modules\\opencode-cluade-auth\\dist\\index.js",
      "C:\\Users\\tester\\AppData\\Roaming\\npm\\node_modules\\opencode-openai-codex-auth\\dist\\index.js",
    ]);
    writeGoogleAuth(home, {
      type: "oauth",
      refresh: "refresh-token|project-123|managed-project-456",
      access: "access-token",
      expires: Date.now() + 60_000,
    });

    const report = buildReadinessReport(project, notesStore, config);
    expect(report.ok).toBe(true);
    expect(report.missingAuthPlugins.length).toBe(0);
  });

  it("prefers OPENCODE_CONFIG_DIR when locating OpenCode config", () => {
    const { root, home, project, config, notesStore } = setup();
    const overrideRoot = join(root, "profiles", "active");
    const overrideOpencodeDir = join(overrideRoot, "opencode");
    mkdirSync(overrideOpencodeDir, { recursive: true });
    writeProvisionedOpencodeConfig(overrideOpencodeDir, config);
    writeGoogleAuth(home, {
      type: "oauth",
      refresh: "refresh-token|project-123|managed-project-456",
      access: "access-token",
      expires: Date.now() + 60_000,
    });
    process.env.OPENCODE_CONFIG_DIR = overrideRoot;

    const report = buildReadinessReport(project, notesStore, config);
    expect(report.checkedConfigPath).toBe(join(overrideOpencodeDir, "opencode.json"));
    expect(report.ok).toBe(true);
  });

  it("uses scanned Aegis install roots under XDG_CONFIG_HOME", () => {
    const { root, home, project, config, notesStore } = setup();
    const xdg = join(root, "xdg");
    const scannedDir = join(xdg, "opencode-team", "opencode");
    mkdirSync(scannedDir, { recursive: true });
    writeProvisionedOpencodeConfig(scannedDir, config);
    writeGoogleAuth(home, {
      type: "oauth",
      refresh: "refresh-token|project-123|managed-project-456",
      access: "access-token",
      expires: Date.now() + 60_000,
    });
    process.env.XDG_CONFIG_HOME = xdg;

    const report = buildReadinessReport(project, notesStore, config);
    expect(report.checkedConfigPath).toBe(join(scannedDir, "opencode.json"));
    expect(report.ok).toBe(true);
  });

  it("fails readiness when Gemini OAuth credentials are incomplete", () => {
    const { home, opencodeDir, project, config, notesStore } = setup();
    writeProvisionedOpencodeConfig(opencodeDir, config);
    writeGoogleAuth(home, {
      type: "oauth",
      refresh: "",
      access: "",
      expires: 0,
    });

    const report = buildReadinessReport(project, notesStore, config);
    expect(report.ok).toBe(false);
    expect(
      report.issues.some((issue) =>
        issue.includes("Google provider is configured but local Google auth credentials are missing or incomplete")
      )
    ).toBe(true);
  });
});
