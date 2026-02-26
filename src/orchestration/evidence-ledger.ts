import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { debugLog } from "../utils/debug-log";

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

const MAX_LEDGER_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_ROTATED_FILES = 3;

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export interface OracleProgress {
  passCount: number;
  failIndex: number;
  totalTests: number;
  passRate: number;
  improved: boolean;
}

export function computeOracleProgress(
  current: { passCount: number; failIndex: number; totalTests: number },
  previous?: { passCount: number; failIndex: number; totalTests: number },
): OracleProgress {
  const passRate = current.totalTests > 0 ? current.passCount / current.totalTests : 0;
  const improved = previous
    ? current.passCount > previous.passCount || (current.failIndex > previous.failIndex && previous.failIndex >= 0)
    : current.passCount > 0;
  return { ...current, passRate, improved };
}

export function scoreEvidence(entries: EvidenceEntry[], oracleProgress?: OracleProgress): {
  score: number;
  level: EvidenceLevel;
  hasAcceptance: boolean;
  oracleWeight: number;
} {
  if (entries.length === 0) {
    return { score: 0, level: "L0", hasAcceptance: false, oracleWeight: 0 };
  }

  const baseScore = entries.reduce((acc, entry) => {
    const weight = EVIDENCE_WEIGHTS[entry.evidenceType] ?? 0;
    return acc + weight * clampConfidence(entry.confidence);
  }, 0);
  const hasAcceptance = entries.some((entry) => entry.evidenceType === "acceptance_oracle");

  let oracleWeight = 0;
  if (oracleProgress && oracleProgress.totalTests > 0) {
    oracleWeight = oracleProgress.passRate * 10;
    if (oracleProgress.improved) oracleWeight += 2;
  }

  const score = baseScore + oracleWeight;

  if (hasAcceptance && score >= 4) {
    return { score: Number(score.toFixed(3)), level: "L3", hasAcceptance: true, oracleWeight: Number(oracleWeight.toFixed(3)) };
  }
  if (score >= 3) {
    return { score: Number(score.toFixed(3)), level: "L2", hasAcceptance, oracleWeight: Number(oracleWeight.toFixed(3)) };
  }
  if (score >= 1) {
    return { score: Number(score.toFixed(3)), level: "L1", hasAcceptance, oracleWeight: Number(oracleWeight.toFixed(3)) };
  }
  return { score: Number(score.toFixed(3)), level: "L0", hasAcceptance, oracleWeight: Number(oracleWeight.toFixed(3)) };
}

function rotateLedgerIfNeeded(ledgerPath: string): void {
  try {
    if (!existsSync(ledgerPath)) return;
    const stat = statSync(ledgerPath);
    if (stat.size < MAX_LEDGER_SIZE_BYTES) return;

    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const older = `${ledgerPath}.${i}`;
      const newer = `${ledgerPath}.${i + 1}`;
      if (existsSync(older)) {
        try {
          renameSync(older, newer);
        } catch (error) {
          debugLog("evidence", `rotate rename ${i}->${i + 1} failed`, error);
        }
      }
    }

    try {
      renameSync(ledgerPath, `${ledgerPath}.1`);
    } catch (error) {
      debugLog("evidence", "rotate current->1 failed", error);
    }
  } catch (error) {
    debugLog("evidence", "rotateLedgerIfNeeded failed", error);
  }
}

export function appendEvidenceLedger(rootDir: string, entry: EvidenceEntry): { ok: true } | { ok: false; reason: string } {
  try {
    mkdirSync(rootDir, { recursive: true });
    const path = join(rootDir, "evidence-ledger.jsonl");
    rotateLedgerIfNeeded(path);
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}
