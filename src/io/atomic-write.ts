import { renameSync, rmSync, writeFileSync } from "node:fs";
import { debugLog } from "../utils/debug-log";

export function atomicWriteFileSync(filePath: string, payload: string): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, payload, "utf-8");
  try {
    renameSync(tmpPath, filePath);
  } catch (renameErr) {
    debugLog("atomic-write", `rename failed for ${filePath}, trying rm+rename`, renameErr);
    try {
      rmSync(filePath, { force: true });
      renameSync(tmpPath, filePath);
    } catch (fallbackErr) {
      debugLog("atomic-write", `rm+rename failed for ${filePath}, falling back to direct write`, fallbackErr);
      writeFileSync(filePath, payload, "utf-8");
    }
  }
}
