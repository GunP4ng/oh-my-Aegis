import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type RouteDecision } from "../src/orchestration/router";
import { NotesStore } from "../src/state/notes-store";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function makeRoot(): string {
  const root = join(tmpdir(), `aegis-notes-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  return root;
}

function makeState(overrides: Partial<SessionState>): SessionState {
  return {
    ...DEFAULT_STATE,
    ...overrides,
    lastUpdatedAt: 0,
  };
}

const decision: RouteDecision = {
  primary: "ctf-solve",
  reason: "test",
};

describe("notes-store", () => {
  it("rotates worklog when budget is exceeded", () => {
    const root = makeRoot();
    const notes = new NotesStore(root, {
      worklog_lines: 8,
      worklog_bytes: 200,
      evidence_lines: 50,
      evidence_bytes: 5000,
      scan_lines: 50,
      scan_bytes: 5000,
      context_pack_lines: 50,
      context_pack_bytes: 5000,
    });

    for (let i = 0; i < 6; i += 1) {
      notes.recordChange(
        "s1",
        makeState({ noNewEvidenceLoops: i, mode: "CTF", phase: "EXECUTE" }),
        "no_new_evidence",
        decision
      );
    }

    const archiveDir = join(root, ".Aegis", "archive");
    const archived = existsSync(archiveDir)
      ? readdirSync(archiveDir).filter((name) => name.startsWith("WORKLOG_"))
      : [];
    expect(archived.length > 0).toBe(true);
    expect(existsSync(join(root, ".Aegis", "WORKLOG.md"))).toBe(true);
  });

  it("writes verified evidence only on verify_success", () => {
    const root = makeRoot();
    const notes = new NotesStore(root, {
      worklog_lines: 200,
      worklog_bytes: 50000,
      evidence_lines: 200,
      evidence_bytes: 50000,
      scan_lines: 200,
      scan_bytes: 50000,
      context_pack_lines: 200,
      context_pack_bytes: 50000,
    });

    notes.recordChange(
      "s2",
      makeState({ mode: "CTF", latestVerified: "flag{ok}" }),
      "verify_success",
      decision
    );

    const content = readFileSync(join(root, ".Aegis", "EVIDENCE.md"), "utf-8");
    expect(content.includes("flag{ok}")).toBe(true);
  });

  it("reports and compacts budget issues on demand", () => {
    const root = makeRoot();
    const notes = new NotesStore(root, {
      worklog_lines: 5,
      worklog_bytes: 120,
      evidence_lines: 200,
      evidence_bytes: 50000,
      scan_lines: 200,
      scan_bytes: 50000,
      context_pack_lines: 200,
      context_pack_bytes: 50000,
    });
    notes.ensureFiles();

    const oversizedWorklog = Array.from({ length: 12 }, (_, idx) => `line-${idx}`).join("\n");
    writeFileSync(join(root, ".Aegis", "WORKLOG.md"), `${oversizedWorklog}\n`, "utf-8");

    const issues = notes.checkBudgets();
    expect(issues.length > 0).toBe(true);

    const actions = notes.compactNow();
    expect(actions.some((action) => action.includes("ROTATED"))).toBe(true);
  });

  it("writes notes to a custom root directory", () => {
    const root = makeRoot();
    const notes = new NotesStore(
      root,
      {
        worklog_lines: 200,
        worklog_bytes: 50000,
        evidence_lines: 200,
        evidence_bytes: 50000,
        scan_lines: 200,
        scan_bytes: 50000,
        context_pack_lines: 200,
        context_pack_bytes: 50000,
      },
      ".sisyphus"
    );
    notes.ensureFiles();
    expect(existsSync(join(root, ".sisyphus", "STATE.md"))).toBe(true);
    expect(existsSync(join(root, ".sisyphus", "SCAN.md"))).toBe(true);
  });
});
