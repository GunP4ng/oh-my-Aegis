import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const APPLY_LOCK_FILE_VERSION = 1;
const DEFAULT_ROOT_DIR = ".Aegis";
const DEFAULT_LOCK_FILE_NAME = "single-writer-apply.lock";
const DEFAULT_STALE_AFTER_MS = 30_000;
const MAX_SESSION_ID_LENGTH = 160;

export interface SingleWriterApplyLockHolder {
  pid: number;
  sessionID: string;
  acquiredAtMs: number;
}

export interface SingleWriterApplyLockAudit {
  acquiredAtMs: number;
  recovered: boolean;
  recoveredAtMs?: number;
  recoveredFrom?: SingleWriterApplyLockHolder;
}

interface SingleWriterApplyLockFile {
  version: typeof APPLY_LOCK_FILE_VERSION;
  holder: SingleWriterApplyLockHolder;
  stalePolicy: {
    staleAfterMs: number;
  };
  audit: SingleWriterApplyLockAudit;
}

export interface SingleWriterApplyLockOptions {
  projectDir: string;
  sessionID: string;
  staleAfterMs?: number;
  pid?: number;
  now?: () => number;
  rootDirName?: string;
  lockFileName?: string;
}

export interface SingleWriterApplyLockSuccessResult<T> {
  ok: true;
  value: T;
  holder: SingleWriterApplyLockHolder;
  audit: SingleWriterApplyLockAudit;
  lockPath: string;
}

export interface SingleWriterApplyLockDeniedResult {
  ok: false;
  reason: "denied";
  holder: SingleWriterApplyLockHolder;
  lockPath: string;
  audit: SingleWriterApplyLockAudit;
}

export interface SingleWriterApplyLockErrorResult {
  ok: false;
  reason: "error";
  message: string;
  lockPath: string;
}

export type SingleWriterApplyLockResult<T> =
  | SingleWriterApplyLockSuccessResult<T>
  | SingleWriterApplyLockDeniedResult
  | SingleWriterApplyLockErrorResult;

interface AcquireSuccess {
  ok: true;
  holder: SingleWriterApplyLockHolder;
  audit: SingleWriterApplyLockAudit;
}

interface AcquireDenied {
  ok: false;
  reason: "denied";
  holder: SingleWriterApplyLockHolder;
  audit: SingleWriterApplyLockAudit;
}

interface AcquireError {
  ok: false;
  reason: "error";
  message: string;
}

type AcquireResult = AcquireSuccess | AcquireDenied | AcquireError;

export function resolveSingleWriterApplyLockPath(
  projectDir: string,
  rootDirName = DEFAULT_ROOT_DIR,
  lockFileName = DEFAULT_LOCK_FILE_NAME,
): string {
  return join(projectDir, rootDirName, "runs", "locks", lockFileName);
}

export class SingleWriterApplyLock {
  private readonly lockPath: string;
  private readonly sessionID: string;
  private readonly staleAfterMs: number;
  private readonly pid: number;
  private readonly now: () => number;

  constructor(options: SingleWriterApplyLockOptions) {
    this.lockPath = resolveSingleWriterApplyLockPath(
      options.projectDir,
      options.rootDirName,
      options.lockFileName,
    );
    this.sessionID = normalizeSessionID(options.sessionID);
    this.staleAfterMs = sanitizeStaleAfterMs(options.staleAfterMs);
    this.pid = sanitizePid(options.pid ?? process.pid);
    this.now = options.now ?? Date.now;
  }

  async withLock<T>(work: () => Promise<T> | T): Promise<SingleWriterApplyLockResult<T>> {
    const acquired = this.acquire();
    if (!acquired.ok) {
      if (acquired.reason === "error") {
        return {
          ok: false,
          reason: "error",
          message: acquired.message,
          lockPath: this.lockPath,
        };
      }
      return {
        ok: false,
        reason: "denied",
        holder: acquired.holder,
        audit: acquired.audit,
        lockPath: this.lockPath,
      };
    }

    try {
      const value = await work();
      return {
        ok: true,
        value,
        holder: acquired.holder,
        audit: acquired.audit,
        lockPath: this.lockPath,
      };
    } finally {
      this.release(acquired.holder);
    }
  }

  private acquire(): AcquireResult {
    mkdirSync(dirname(this.lockPath), { recursive: true });
    let recoveredFrom: SingleWriterApplyLockHolder | undefined;

    for (let attempts = 0; attempts < 4; attempts += 1) {
      const now = this.now();
      const holder: SingleWriterApplyLockHolder = {
        pid: this.pid,
        sessionID: this.sessionID,
        acquiredAtMs: now,
      };
      const audit: SingleWriterApplyLockAudit = recoveredFrom
        ? {
          acquiredAtMs: now,
          recovered: true,
          recoveredAtMs: now,
          recoveredFrom,
        }
        : {
          acquiredAtMs: now,
          recovered: false,
        };
      const payload: SingleWriterApplyLockFile = {
        version: APPLY_LOCK_FILE_VERSION,
        holder,
        stalePolicy: { staleAfterMs: this.staleAfterMs },
        audit,
      };

      try {
        writeFileSync(this.lockPath, `${JSON.stringify(payload)}\n`, {
          encoding: "utf-8",
          flag: "wx",
          mode: 0o600,
        });
        return { ok: true, holder, audit };
      } catch (error) {
        if (!isEexist(error)) {
          return {
            ok: false,
            reason: "error",
            message: error instanceof Error ? error.message : String(error),
          };
        }

        const existing = readLockHolder(this.lockPath);
        const denyAudit: SingleWriterApplyLockAudit = {
          acquiredAtMs: now,
          recovered: false,
        };

        if (!existing) {
          return {
            ok: false,
            reason: "denied",
            holder: {
              pid: 0,
              sessionID: "unknown",
              acquiredAtMs: 0,
            },
            audit: denyAudit,
          };
        }

        const stale = now - existing.acquiredAtMs >= this.staleAfterMs;
        if (!stale) {
          return {
            ok: false,
            reason: "denied",
            holder: existing,
            audit: denyAudit,
          };
        }

        const tombstonePath = `${this.lockPath}.stale.${existing.acquiredAtMs}.${existing.pid}.${now}`;
        try {
          renameSync(this.lockPath, tombstonePath);
          unlinkSync(tombstonePath);
          recoveredFrom = existing;
          continue;
        } catch (renameError) {
          if (isEnoent(renameError)) {
            continue;
          }
          return {
            ok: false,
            reason: "error",
            message: renameError instanceof Error ? renameError.message : String(renameError),
          };
        }
      }
    }

    return {
      ok: false,
      reason: "error",
      message: "apply lock acquisition retries exhausted",
    };
  }

  private release(owner: SingleWriterApplyLockHolder): void {
    try {
      const existing = readLockHolder(this.lockPath);
      if (!existing) return;
      if (
        existing.pid !== owner.pid
        || existing.sessionID !== owner.sessionID
        || existing.acquiredAtMs !== owner.acquiredAtMs
      ) {
        return;
      }
      unlinkSync(this.lockPath);
    } catch (error) {
      if (!isEnoent(error)) {
        return;
      }
    }
  }
}

function readLockHolder(lockPath: string): SingleWriterApplyLockHolder | null {
  try {
    const raw = readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SingleWriterApplyLockFile>;
    if (parsed.version !== APPLY_LOCK_FILE_VERSION) return null;
    if (!parsed.holder || typeof parsed.holder !== "object") return null;
    return {
      pid: sanitizePid(parsed.holder.pid),
      sessionID: normalizeSessionID(parsed.holder.sessionID),
      acquiredAtMs: sanitizeTimestamp(parsed.holder.acquiredAtMs),
    };
  } catch {
    return null;
  }
}

function sanitizeStaleAfterMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_STALE_AFTER_MS;
  return Math.max(1_000, Math.min(86_400_000, Math.floor(value as number)));
}

function sanitizePid(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(2_147_483_647, Math.floor(value as number)));
}

function sanitizeTimestamp(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value as number));
}

function normalizeSessionID(value: string): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim();
  if (!normalized) return "unknown";
  return normalized.slice(0, MAX_SESSION_ID_LENGTH);
}

function isEexist(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "EEXIST";
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
