/**
 * Hypothesis Experiment Registry
 *
 * Structured storage for hypothesis → disconfirm experiment → evidence → verdict.
 * Prevents re-running identical experiments and enables audit trail.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { debugLog } from "../utils/debug-log";

export type HypothesisStatus =
  | "active"
  | "confirmed"
  | "refuted"
  | "superseded"
  | "stale";

export type ExperimentVerdict =
  | "supports"
  | "refutes"
  | "inconclusive";

export interface Experiment {
  id: string;
  description: string;
  method: string;
  artifactPaths: string[];
  verdict: ExperimentVerdict;
  evidence: string;
  timestamp: string;
}

export interface HypothesisRecord {
  id: string;
  hypothesis: string;
  status: HypothesisStatus;
  createdAt: string;
  updatedAt: string;
  experiments: Experiment[];
  supersededBy?: string;
  tags: string[];
}

export class HypothesisRegistry {
  private records: Map<string, HypothesisRecord> = new Map();
  private readonly storePath: string;
  private nextId = 1;
  private nextExpId = 1;

  constructor(rootDir: string) {
    this.storePath = join(rootDir, "hypothesis-registry.jsonl");
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.storePath)) return;
      const content = readFileSync(this.storePath, "utf-8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line) as HypothesisRecord;
          this.records.set(record.id, record);
          const numericId = parseInt(record.id.replace("H", ""), 10);
          if (numericId >= this.nextId) this.nextId = numericId + 1;
          for (const exp of record.experiments) {
            const expNumId = parseInt(exp.id.replace("E", ""), 10);
            if (expNumId >= this.nextExpId) this.nextExpId = expNumId + 1;
          }
        } catch {
          debugLog("hypothesis", `skipping malformed line`);
        }
      }
    } catch (error) {
      debugLog("hypothesis", "load failed", error);
    }
  }

  private persist(record: HypothesisRecord): void {
    try {
      mkdirSync(join(this.storePath, ".."), { recursive: true });
      appendFileSync(this.storePath, `${JSON.stringify(record)}\n`, "utf-8");
    } catch (error) {
      debugLog("hypothesis", "persist failed", error);
    }
  }

  createHypothesis(hypothesis: string, tags: string[] = []): HypothesisRecord {
    const id = `H${this.nextId++}`;
    const now = new Date().toISOString();
    const record: HypothesisRecord = {
      id,
      hypothesis,
      status: "active",
      createdAt: now,
      updatedAt: now,
      experiments: [],
      tags,
    };
    this.records.set(id, record);
    this.persist(record);
    return record;
  }

  addExperiment(
    hypothesisId: string,
    description: string,
    method: string,
    artifactPaths: string[],
    verdict: ExperimentVerdict,
    evidence: string,
  ): Experiment | null {
    const record = this.records.get(hypothesisId);
    if (!record) return null;

    const duplicate = record.experiments.find(
      (e) => e.method === method && e.description === description,
    );
    if (duplicate) {
      debugLog("hypothesis", `duplicate experiment skipped: ${description} on ${hypothesisId}`);
      return duplicate;
    }

    const exp: Experiment = {
      id: `E${this.nextExpId++}`,
      description,
      method,
      artifactPaths,
      verdict,
      evidence,
      timestamp: new Date().toISOString(),
    };

    record.experiments.push(exp);
    record.updatedAt = exp.timestamp;

    if (verdict === "refutes") {
      record.status = "refuted";
    }

    this.persist(record);
    return exp;
  }

  updateStatus(hypothesisId: string, status: HypothesisStatus, supersededBy?: string): boolean {
    const record = this.records.get(hypothesisId);
    if (!record) return false;

    record.status = status;
    record.updatedAt = new Date().toISOString();
    if (supersededBy) record.supersededBy = supersededBy;

    this.persist(record);
    return true;
  }

  getActive(): HypothesisRecord[] {
    return [...this.records.values()].filter((r) => r.status === "active");
  }

  getAll(): HypothesisRecord[] {
    return [...this.records.values()];
  }

  get(id: string): HypothesisRecord | undefined {
    return this.records.get(id);
  }

  /**
   * Check if a specific method+description experiment has already been run
   * for ANY active hypothesis, preventing duplicate experiments.
   */
  hasExperiment(method: string, description: string): boolean {
    for (const record of this.records.values()) {
      if (record.experiments.some((e) => e.method === method && e.description === description)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Mark all active hypotheses as stale when context or approach fundamentally shifts.
   */
  markAllActiveAsStale(): number {
    let count = 0;
    const now = new Date().toISOString();
    for (const record of this.records.values()) {
      if (record.status === "active") {
        record.status = "stale";
        record.updatedAt = now;
        this.persist(record);
        count++;
      }
    }
    return count;
  }

  /**
   * Generate a summary of all hypotheses and experiments for context injection.
   */
  summarize(): string {
    const records = this.getAll();
    if (records.length === 0) return "No hypotheses registered.";

    const lines: string[] = [`Hypothesis Registry (${records.length} total):`];
    for (const r of records) {
      const expSummary = r.experiments.length > 0
        ? r.experiments.map((e) => `    ${e.id}: ${e.verdict} — ${e.description}`).join("\n")
        : "    (no experiments)";
      lines.push(`  ${r.id} [${r.status}] ${r.hypothesis}`);
      lines.push(expSummary);
    }
    return lines.join("\n");
  }
}
