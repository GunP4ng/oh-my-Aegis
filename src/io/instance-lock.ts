import { writeFileSync, unlinkSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface InstanceLockInfo { pid: number; startedAt: number; }
export interface InstanceLockResult {
  ok: boolean;
  reason: "acquired" | "already_running" | "error";
  holder?: InstanceLockInfo;
}

export function tryReadInstanceLock(lockPath: string): InstanceLockInfo | null {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8")) as InstanceLockInfo;
  } catch {
    return null;
  }
}

export function releaseInstanceLock(lockPath: string): void {
  try {
    const info = tryReadInstanceLock(lockPath);
    if (info?.pid === process.pid) {
      unlinkSync(lockPath);
    }
  } catch {
    // silent
  }
}

export function tryAcquireInstanceLock(lockPath: string): InstanceLockResult {
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
    const info: InstanceLockInfo = { pid: process.pid, startedAt: Date.now() };
    writeFileSync(lockPath, JSON.stringify(info), { flag: "wx" });
    process.on("exit", () => releaseInstanceLock(lockPath));
    return { ok: true, reason: "acquired" };
  } catch (err: any) {
    if (err?.code === "EEXIST") {
      const holder = tryReadInstanceLock(lockPath);
      if (holder) {
        try {
          process.kill(holder.pid, 0);
          // process is alive
          return { ok: false, reason: "already_running", holder };
        } catch (killErr: any) {
          if (killErr?.code === "ESRCH") {
            // dead process, clean up and retry
            try { unlinkSync(lockPath); } catch {}
            return tryAcquireInstanceLock(lockPath);
          }
          // EPERM or other: process exists
          return { ok: false, reason: "already_running", holder };
        }
      }
    }
    return { ok: false, reason: "error" };
  }
}
