import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

export const JSONL_MAX_SIZE_BYTES = 2 * 1024 * 1024;  // 2 MB
export const JSONL_MAX_ROTATED_FILES = 3;

export function rotateJsonlIfNeeded(filePath: string): void {
  try {
    if (!existsSync(filePath)) return;
    const stat = statSync(filePath);
    if (stat.size < JSONL_MAX_SIZE_BYTES) return;

    for (let i = JSONL_MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const older = `${filePath}.${i}`;
      const newer = `${filePath}.${i + 1}`;
      if (existsSync(older)) {
        try {
          renameSync(older, newer);
        } catch {
          // silent
        }
      }
    }

    try {
      renameSync(filePath, `${filePath}.1`);
    } catch {
      // silent
    }
  } catch {
    // silent
  }
}

export function appendJsonlRecord(filePath: string, record: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  rotateJsonlIfNeeded(filePath);
  appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8");
}

export function appendJsonlRecords(filePath: string, records: Record<string, unknown>[]): void {
  if (records.length === 0) {
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  rotateJsonlIfNeeded(filePath);
  appendFileSync(filePath, records.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf-8");
}
