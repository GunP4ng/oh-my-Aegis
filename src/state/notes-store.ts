import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { OrchestratorConfig } from "../config/schema";
import type { RouteDecision } from "../orchestration/router";
import type { StoreChangeReason } from "./session-store";
import type { SessionState } from "./types";

interface FileBudget {
  lines: number;
  bytes: number;
}

export interface BudgetIssue {
  fileName: string;
  lineCount: number;
  byteCount: number;
  maxLines: number;
  maxBytes: number;
}

export class NotesStore {
  private readonly rootDir: string;
  private readonly archiveDir: string;
  private readonly budgets: {
    WORKLOG: FileBudget;
    EVIDENCE: FileBudget;
    SCAN: FileBudget;
    CONTEXT_PACK: FileBudget;
  };

  constructor(
    baseDirectory: string,
    markdownBudget: OrchestratorConfig["markdown_budget"],
    rootDirName: string = ".Aegis"
  ) {
    this.rootDir = join(baseDirectory, rootDirName);
    this.archiveDir = join(this.rootDir, "archive");
    this.budgets = {
      WORKLOG: { lines: markdownBudget.worklog_lines, bytes: markdownBudget.worklog_bytes },
      EVIDENCE: { lines: markdownBudget.evidence_lines, bytes: markdownBudget.evidence_bytes },
      SCAN: { lines: markdownBudget.scan_lines, bytes: markdownBudget.scan_bytes },
      CONTEXT_PACK: {
        lines: markdownBudget.context_pack_lines,
        bytes: markdownBudget.context_pack_bytes,
      },
    };
  }

  getRootDirectory(): string {
    return this.rootDir;
  }

  checkWritable(): { ok: boolean; issues: string[] } {
    const issues: string[] = [];
    try {
      this.ensureFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`failed to initialize notes directory '${this.rootDir}': ${message}`);
      return { ok: false, issues };
    }

    const targets = [
      this.rootDir,
      join(this.rootDir, "STATE.md"),
      join(this.rootDir, "WORKLOG.md"),
      join(this.rootDir, "EVIDENCE.md"),
      join(this.rootDir, "SCAN.md"),
      join(this.rootDir, "CONTEXT_PACK.md"),
    ];

    for (const target of targets) {
      try {
        accessSync(target, constants.W_OK);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.push(`not writable: ${target} (${message})`);
      }
    }

    return { ok: issues.length === 0, issues };
  }

  ensureFiles(): void {
    mkdirSync(this.rootDir, { recursive: true });
    mkdirSync(this.archiveDir, { recursive: true });
    this.ensureFile("STATE.md", "# STATE\n");
    this.ensureFile("WORKLOG.md", "# WORKLOG\n");
    this.ensureFile("EVIDENCE.md", "# EVIDENCE\n");
    this.ensureFile("SCAN.md", "# SCAN\n");
    this.ensureFile("CONTEXT_PACK.md", "# CONTEXT_PACK\n");
  }

  recordChange(
    sessionID: string,
    state: SessionState,
    reason: StoreChangeReason,
    decision: RouteDecision
  ): void {
    this.ensureFiles();
    this.writeState(sessionID, state, decision);
    this.writeContextPack(sessionID, state, decision);
    this.appendWorklog(sessionID, state, reason, decision);
    if (reason === "verify_success") {
      this.appendEvidence(sessionID, state);
    }
  }

  recordScan(summary: string): void {
    this.appendWithBudget("SCAN.md", `\n## ${this.now()}\n- ${summary}\n`, this.budgets.SCAN);
  }

  recordInjectionAttempt(source: string, indicators: string[], snippet: string): void {
    const compactSnippet = snippet.replace(/\s+/g, " ").trim().slice(0, 240);
    const summary = `INJECTION-ATTEMPT source=${source} indicators=${indicators.join(",")} snippet=${compactSnippet || "(empty)"}`;
    this.recordScan(summary);
  }

  checkBudgets(): BudgetIssue[] {
    this.ensureFiles();
    return [
      this.inspectFile("WORKLOG.md", this.budgets.WORKLOG),
      this.inspectFile("EVIDENCE.md", this.budgets.EVIDENCE),
      this.inspectFile("SCAN.md", this.budgets.SCAN),
      this.inspectFile("CONTEXT_PACK.md", this.budgets.CONTEXT_PACK),
    ].filter((issue): issue is BudgetIssue => issue !== null);
  }

  compactNow(): string[] {
    this.ensureFiles();
    const actions: string[] = [];
    const files: Array<[string, FileBudget]> = [
      ["WORKLOG.md", this.budgets.WORKLOG],
      ["EVIDENCE.md", this.budgets.EVIDENCE],
      ["SCAN.md", this.budgets.SCAN],
      ["CONTEXT_PACK.md", this.budgets.CONTEXT_PACK],
    ];

    for (const [fileName, budget] of files) {
      const rotated = this.rotateIfNeeded(fileName, budget);
      if (rotated) {
        actions.push(`ROTATED ${fileName}`);
      }
    }

    if (actions.length === 0) {
      actions.push("No files exceeded markdown budget.");
    }

    return actions;
  }

  private ensureFile(fileName: string, initial: string): void {
    const path = join(this.rootDir, fileName);
    if (!existsSync(path)) {
      writeFileSync(path, `${initial}\n`, "utf-8");
    }
  }

  private writeState(sessionID: string, state: SessionState, decision: RouteDecision): void {
    const path = join(this.rootDir, "STATE.md");
    const content = [
      "# STATE",
      `updated_at: ${this.now()}`,
      `session_id: ${sessionID}`,
      `mode: ${state.mode}`,
      `phase: ${state.phase}`,
      `target: ${state.targetType}`,
      `scope_confirmed: ${state.scopeConfirmed}`,
      `candidate_pending_verification: ${state.candidatePendingVerification}`,
      `latest_candidate: ${state.latestCandidate || "(none)"}`,
      `latest_verified: ${state.latestVerified || "(none)"}`,
      `hypothesis: ${state.hypothesis || "(none)"}`,
      `next_route: ${decision.primary}`,
      `next_reason: ${decision.reason}`,
      "",
    ].join("\n");
    writeFileSync(path, content, "utf-8");
  }

  private writeContextPack(sessionID: string, state: SessionState, decision: RouteDecision): void {
    const path = join(this.rootDir, "CONTEXT_PACK.md");
    const content = [
      "# CONTEXT_PACK",
      `updated_at: ${this.now()}`,
      `session_id: ${sessionID}`,
      `mode=${state.mode}, phase=${state.phase}, target=${state.targetType}`,
      `scope_confirmed=${state.scopeConfirmed}, candidate_pending=${state.candidatePendingVerification}`,
      `verify_fail_count=${state.verifyFailCount}, no_new_evidence=${state.noNewEvidenceLoops}, same_payload=${state.samePayloadLoops}`,
      `context_fail=${state.contextFailCount}, timeout_fail=${state.timeoutFailCount}`,
      `latest_candidate=${state.latestCandidate || "(none)"}`,
      `latest_verified=${state.latestVerified || "(none)"}`,
      `hypothesis=${state.hypothesis || "(none)"}`,
      `next_route=${decision.primary}`,
      "",
    ].join("\n");
    writeFileSync(path, content, "utf-8");
    this.rotateIfNeeded("CONTEXT_PACK.md", this.budgets.CONTEXT_PACK);
  }

  private appendWorklog(
    sessionID: string,
    state: SessionState,
    reason: StoreChangeReason,
    decision: RouteDecision
  ): void {
    const block = [
      "",
      `## ${this.now()}`,
      `- session: ${sessionID}`,
      `- reason: ${reason}`,
      `- mode/phase/target: ${state.mode}/${state.phase}/${state.targetType}`,
      `- scope/candidate: ${state.scopeConfirmed}/${state.candidatePendingVerification}`,
      `- counters: verify_fail=${state.verifyFailCount}, no_new=${state.noNewEvidenceLoops}, same_payload=${state.samePayloadLoops}, context_fail=${state.contextFailCount}, timeout_fail=${state.timeoutFailCount}`,
      `- next: ${decision.primary} (${decision.reason})`,
      "",
    ].join("\n");
    this.appendWithBudget("WORKLOG.md", block, this.budgets.WORKLOG);
  }

  private appendEvidence(sessionID: string, state: SessionState): void {
    const verified = state.latestVerified || state.latestCandidate;
    if (!verified) {
      return;
    }
    const block = [
      "",
      `## ${this.now()}`,
      `- session: ${sessionID}`,
      `- verified: ${verified}`,
      "",
    ].join("\n");
    this.appendWithBudget("EVIDENCE.md", block, this.budgets.EVIDENCE);
  }

  private appendWithBudget(fileName: string, content: string, budget: FileBudget): void {
    const path = join(this.rootDir, fileName);
    appendFileSync(path, content, "utf-8");
    this.rotateIfNeeded(fileName, budget);
  }

  private rotateIfNeeded(fileName: string, budget: FileBudget): boolean {
    const path = join(this.rootDir, fileName);
    if (!existsSync(path)) {
      return false;
    }
    const content = readFileSync(path, "utf-8");
    const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
    const byteCount = Buffer.byteLength(content, "utf-8");
    if (lineCount <= budget.lines && byteCount <= budget.bytes) {
      return false;
    }

    const stamp = this.archiveStamp();
    const stem = fileName.replace(/\.md$/i, "");
    const archived = join(this.archiveDir, `${stem}_${stamp}.md`);
    renameSync(path, archived);
    writeFileSync(path, `# ${stem}\n\nRotated at ${this.now()}\n\n`, "utf-8");
    return true;
  }

  private inspectFile(fileName: string, budget: FileBudget): BudgetIssue | null {
    const path = join(this.rootDir, fileName);
    if (!existsSync(path)) {
      return null;
    }

    const content = readFileSync(path, "utf-8");
    const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
    const byteCount = Buffer.byteLength(content, "utf-8");
    if (lineCount <= budget.lines && byteCount <= budget.bytes) {
      return null;
    }

    return {
      fileName,
      lineCount,
      byteCount,
      maxLines: budget.lines,
      maxBytes: budget.bytes,
    };
  }

  private now(): string {
    return new Date().toISOString();
  }

  private archiveStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }
}
