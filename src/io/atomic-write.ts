import { renameSync, rmSync, writeFileSync } from "node:fs";

export function atomicWriteFileSync(filePath: string, payload: string): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, payload, "utf-8");
  try {
    renameSync(tmpPath, filePath);
  } catch {
    try {
      rmSync(filePath, { force: true });
      renameSync(tmpPath, filePath);
    } catch {
      writeFileSync(filePath, payload, "utf-8");
    }
  }
}
