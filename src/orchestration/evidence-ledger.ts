import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type EvidenceType =
  | "string_pattern"
  | "static_reverse"
  | "dynamic_memory"
  | "behavioral_runtime"
  | "acceptance_oracle";

export type EvidenceLevel = "L0" | "L1" | "L2" | "L3";

export interface EvidenceEntry {
  at: string;
  sessionID: string;
  event: string;
  evidenceType: EvidenceType;
  confidence: number;
  summary: string;
  source: string;
}

const EVIDENCE_WEIGHTS: Record<EvidenceType, number> = {
  string_pattern: 1,
  static_reverse: 2,
  dynamic_memory: 3,
  behavioral_runtime: 4,
  acceptance_oracle: 5,
};

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function scoreEvidence(entries: EvidenceEntry[]): {
  score: number;
  level: EvidenceLevel;
  hasAcceptance: boolean;
} {
  if (entries.length === 0) {
    return { score: 0, level: "L0", hasAcceptance: false };
  }

  const score = entries.reduce((acc, entry) => {
    const weight = EVIDENCE_WEIGHTS[entry.evidenceType] ?? 0;
    return acc + weight * clampConfidence(entry.confidence);
  }, 0);
  const hasAcceptance = entries.some((entry) => entry.evidenceType === "acceptance_oracle");

  if (hasAcceptance && score >= 4) {
    return { score: Number(score.toFixed(3)), level: "L3", hasAcceptance: true };
  }
  if (score >= 3) {
    return { score: Number(score.toFixed(3)), level: "L2", hasAcceptance };
  }
  if (score >= 1) {
    return { score: Number(score.toFixed(3)), level: "L1", hasAcceptance };
  }
  return { score: Number(score.toFixed(3)), level: "L0", hasAcceptance };
}

export function appendEvidenceLedger(rootDir: string, entry: EvidenceEntry): { ok: true } | { ok: false; reason: string } {
  try {
    mkdirSync(rootDir, { recursive: true });
    const path = join(rootDir, "evidence-ledger.jsonl");
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}
