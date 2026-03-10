import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function appendJsonlRecord(filePath: string, record: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8");
}

export function appendJsonlRecords(filePath: string, records: Record<string, unknown>[]): void {
  if (records.length === 0) {
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, records.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf-8");
}
