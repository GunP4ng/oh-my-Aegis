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
import { DebouncedSyncFlusher } from "./debounced-sync-flusher";
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

export interface NotesStoreFlushMetric {
  trigger: "immediate" | "timer" | "manual";
  durationMs: number;
  filesTouched: number;
  appendBytes: number;
  replaceBytes: number;
  asyncPersistence: boolean;
  failed: boolean;
  reason: string;
}

export interface NotesStoreOptions {
  asyncPersistence?: boolean;
  flushDelayMs?: number;
  onFlush?: (metric: NotesStoreFlushMetric) => void;
}

interface PendingFileMutation {
  replace: string | null;
  append: string[];
  budget: FileBudget | null;
}

export class NotesStore {
  private readonly rootDir: string;
  private readonly archiveDir: string;
  private readonly asyncPersistence: boolean;
  private readonly onFlush?: (metric: NotesStoreFlushMetric) => void;
  private readonly budgets: {
    WORKLOG: FileBudget;
    EVIDENCE: FileBudget;
    SCAN: FileBudget;
    CONTEXT_PACK: FileBudget;
  };
  private persistenceDegraded = false;
  private readonly pendingByFile = new Map<string, PendingFileMutation>();
  private readonly flushFlusher: DebouncedSyncFlusher<
    {
      ok: boolean;
      filesTouched: number;
      appendBytes: number;
      replaceBytes: number;
      reason: string;
    },
    NotesStoreFlushMetric
  >;

  constructor(
    baseDirectory: string,
    markdownBudget: OrchestratorConfig["markdown_budget"],
    rootDirName: string = ".Aegis",
    options: NotesStoreOptions = {}
  ) {
    this.rootDir = join(baseDirectory, rootDirName);
    this.archiveDir = join(this.rootDir, "archive");
    this.asyncPersistence = options.asyncPersistence === true;
    const flushDelayMs =
      typeof options.flushDelayMs === "number" && Number.isFinite(options.flushDelayMs)
        ? Math.max(0, Math.floor(options.flushDelayMs))
        : 35;
    this.onFlush = options.onFlush;
    this.budgets = {
      WORKLOG: { lines: markdownBudget.worklog_lines, bytes: markdownBudget.worklog_bytes },
      EVIDENCE: { lines: markdownBudget.evidence_lines, bytes: markdownBudget.evidence_bytes },
      SCAN: { lines: markdownBudget.scan_lines, bytes: markdownBudget.scan_bytes },
      CONTEXT_PACK: {
        lines: markdownBudget.context_pack_lines,
        bytes: markdownBudget.context_pack_bytes,
      },
    };
    this.flushFlusher = new DebouncedSyncFlusher({
      enabled: this.asyncPersistence,
      delayMs: flushDelayMs,
      isBlocked: () => this.persistenceDegraded,
      runSync: () => this.flushPendingSync(),
      buildMetric: ({ trigger, durationMs, result }) => ({
        trigger,
        durationMs,
        filesTouched: result.filesTouched,
        appendBytes: result.appendBytes,
        replaceBytes: result.replaceBytes,
        asyncPersistence: this.asyncPersistence,
        failed: !result.ok,
        reason: result.reason,
      }),
      onMetric: this.onFlush,
    });
  }

  getRootDirectory(): string {
    return this.rootDir;
  }

  flushNow(): void {
    this.flushFlusher.flushNow();
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
    if (!this.asyncPersistence) {
      this.ensureFiles();
      this.writeState(sessionID, state, decision);
      this.writeContextPack(sessionID, state, decision);
      this.appendWorklog(sessionID, state, reason, decision);
      if (reason === "verify_success") {
        this.appendEvidence(sessionID, state);
      }
      return;
    }

    const stateContent = this.buildStateContent(sessionID, state, decision);
    this.queueReplace("STATE.md", stateContent, null);
    const contextPackContent = this.buildContextPackContent(sessionID, state, decision);
    this.queueReplace("CONTEXT_PACK.md", contextPackContent, this.budgets.CONTEXT_PACK);
    const worklogBlock = this.buildWorklogBlock(sessionID, state, reason, decision);
    this.queueAppend("WORKLOG.md", worklogBlock, this.budgets.WORKLOG);
    if (reason === "verify_success") {
      const evidenceBlock = this.buildEvidenceBlock(sessionID, state);
      if (evidenceBlock) {
        this.queueAppend("EVIDENCE.md", evidenceBlock, this.budgets.EVIDENCE);
      }
    }
    this.flushFlusher.request();
  }

  recordScan(summary: string): void {
    const block = `\n## ${this.now()}\n- ${summary}\n`;
    if (!this.asyncPersistence) {
      this.appendWithBudget("SCAN.md", block, this.budgets.SCAN);
      return;
    }
    this.queueAppend("SCAN.md", block, this.budgets.SCAN);
    this.flushFlusher.request();
  }

  recordInjectionAttempt(source: string, indicators: string[], snippet: string): void {
    const compactSnippet = snippet.replace(/\s+/g, " ").trim().slice(0, 240);
    const summary = `INJECTION-ATTEMPT source=${source} indicators=${indicators.join(",")} snippet=${compactSnippet || "(empty)"}`;
    this.recordScan(summary);
  }

  checkBudgets(): BudgetIssue[] {
    this.flushNow();
    this.ensureFiles();
    return [
      this.inspectFile("WORKLOG.md", this.budgets.WORKLOG),
      this.inspectFile("EVIDENCE.md", this.budgets.EVIDENCE),
      this.inspectFile("SCAN.md", this.budgets.SCAN),
      this.inspectFile("CONTEXT_PACK.md", this.budgets.CONTEXT_PACK),
    ].filter((issue): issue is BudgetIssue => issue !== null);
  }

  compactNow(): string[] {
    this.flushNow();
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
    writeFileSync(path, this.buildStateContent(sessionID, state, decision), "utf-8");
  }

  private buildStateContent(sessionID: string, state: SessionState, decision: RouteDecision): string {
    return [
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
  }

  private writeContextPack(sessionID: string, state: SessionState, decision: RouteDecision): void {
    const path = join(this.rootDir, "CONTEXT_PACK.md");
    writeFileSync(path, this.buildContextPackContent(sessionID, state, decision), "utf-8");
    this.rotateIfNeeded("CONTEXT_PACK.md", this.budgets.CONTEXT_PACK);
  }

  private buildContextPackContent(sessionID: string, state: SessionState, decision: RouteDecision): string {
    return [
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
  }

  private appendWorklog(
    sessionID: string,
    state: SessionState,
    reason: StoreChangeReason,
    decision: RouteDecision
  ): void {
    this.appendWithBudget("WORKLOG.md", this.buildWorklogBlock(sessionID, state, reason, decision), this.budgets.WORKLOG);
  }

  private buildWorklogBlock(
    sessionID: string,
    state: SessionState,
    reason: StoreChangeReason,
    decision: RouteDecision
  ): string {
    return [
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
  }

  private appendEvidence(sessionID: string, state: SessionState): void {
    const block = this.buildEvidenceBlock(sessionID, state);
    if (!block) {
      return;
    }
    this.appendWithBudget("EVIDENCE.md", block, this.budgets.EVIDENCE);
  }

  private buildEvidenceBlock(sessionID: string, state: SessionState): string | null {
    const verified = state.latestVerified || state.latestCandidate;
    if (!verified) {
      return null;
    }
    return [
      "",
      `## ${this.now()}`,
      `- session: ${sessionID}`,
      `- verified: ${verified}`,
      "",
    ].join("\n");
  }

  private appendWithBudget(fileName: string, content: string, budget: FileBudget): void {
    const path = join(this.rootDir, fileName);
    appendFileSync(path, content, "utf-8");
    this.rotateIfNeeded(fileName, budget);
  }

  private queueReplace(fileName: string, content: string, budget: FileBudget | null): void {
    if (this.persistenceDegraded) {
      return;
    }
    const current = this.pendingByFile.get(fileName) ?? { replace: null, append: [], budget: null };
    current.replace = content;
    if (budget) {
      current.budget = budget;
    }
    this.pendingByFile.set(fileName, current);
  }

  private queueAppend(fileName: string, content: string, budget: FileBudget | null): void {
    if (this.persistenceDegraded) {
      return;
    }
    const current = this.pendingByFile.get(fileName) ?? { replace: null, append: [], budget: null };
    current.append.push(content);
    if (budget) {
      current.budget = budget;
    }
    this.pendingByFile.set(fileName, current);
  }

  private flushPendingSync(): {
    ok: boolean;
    filesTouched: number;
    appendBytes: number;
    replaceBytes: number;
    reason: string;
  } {
    const filesTouched = this.pendingByFile.size;
    if (filesTouched === 0) {
      return { ok: true, filesTouched: 0, appendBytes: 0, replaceBytes: 0, reason: "" };
    }
    let appendBytes = 0;
    let replaceBytes = 0;
    try {
      this.ensureFiles();
      for (const [fileName, pending] of this.pendingByFile.entries()) {
        const path = join(this.rootDir, fileName);
        if (pending.replace !== null) {
          writeFileSync(path, pending.replace, "utf-8");
          replaceBytes += Buffer.byteLength(pending.replace, "utf-8");
        }
        if (pending.append.length > 0) {
          const chunk = pending.append.join("");
          appendFileSync(path, chunk, "utf-8");
          appendBytes += Buffer.byteLength(chunk, "utf-8");
        }
        if (pending.budget) {
          this.rotateIfNeeded(fileName, pending.budget);
        }
      }
      this.pendingByFile.clear();
      return { ok: true, filesTouched, appendBytes, replaceBytes, reason: "" };
    } catch {
      this.persistenceDegraded = true;
      return { ok: false, filesTouched, appendBytes, replaceBytes, reason: "flush_failed" };
    }
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
