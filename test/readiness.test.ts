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

afterEach(() => {
  process.env.HOME = originalHome;
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

  it("passes readiness when required matrix subagents are provisioned", () => {
    const { opencodeDir, project, config, notesStore } = setup();
    const required = new Set(requiredDispatchSubagents(config));
    required.add(config.failover.map.explore);
    required.add(config.failover.map.librarian);
    required.add(config.failover.map.oracle);

    const agentMap: Record<string, { model: string; variant: string }> = {};
    for (const name of required) {
      agentMap[name] = { model: "test/model", variant: "low" };
    }

    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify(
        {
          agent: agentMap,
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

    const report = buildReadinessReport(project, notesStore, config);
    expect(report.ok).toBe(true);
    expect(report.missingSubagents.length).toBe(0);
    expect(report.missingMcps.length).toBe(0);
    expect(report.coverageByTarget["CTF:FORENSICS"].missingSubagents.length).toBe(0);
  });
});
