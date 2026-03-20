import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  tryAcquireInstanceLock,
  releaseInstanceLock,
  tryReadInstanceLock,
  type InstanceLockInfo,
} from "../src/io/instance-lock";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `instance-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // silent
  }
}

describe("instance lock", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it("first acquisition succeeds with reason 'acquired'", () => {
    const lockPath = join(tmpDir, "test.lock");
    const result = tryAcquireInstanceLock(lockPath);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("acquired");
    expect(existsSync(lockPath)).toBe(true);
    // Cleanup
    unlinkSync(lockPath);
  });

  it("second acquisition on same path returns already_running", () => {
    const lockPath = join(tmpDir, "double.lock");

    // First acquire
    const r1 = tryAcquireInstanceLock(lockPath);
    expect(r1.ok).toBe(true);
    expect(r1.reason).toBe("acquired");

    // Second acquire - should fail
    const r2 = tryAcquireInstanceLock(lockPath);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("already_running");
    expect(r2.holder).toBeDefined();
    expect(r2.holder!.pid).toBe(process.pid);

    // Cleanup
    unlinkSync(lockPath);
  });

  it("stale lock with dead PID is cleaned up and re-acquired", () => {
    const lockPath = join(tmpDir, "stale.lock");

    // Write a lock file with a PID that is almost certainly dead
    // Use PID 99999999 which won't exist on any normal system
    const staleInfo: InstanceLockInfo = { pid: 99999999, startedAt: Date.now() - 100000 };
    writeFileSync(lockPath, JSON.stringify(staleInfo));

    const result = tryAcquireInstanceLock(lockPath);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("acquired");
    expect(existsSync(lockPath)).toBe(true);

    // Cleanup
    unlinkSync(lockPath);
  });

  it("releaseInstanceLock with different PID does not delete the lock", () => {
    const lockPath = join(tmpDir, "other-pid.lock");

    // Write a lock file with a different PID
    const otherInfo: InstanceLockInfo = { pid: 99999998, startedAt: Date.now() };
    writeFileSync(lockPath, JSON.stringify(otherInfo));

    // Attempt to release (this process's PID doesn't match)
    releaseInstanceLock(lockPath);

    // Lock should still exist
    expect(existsSync(lockPath)).toBe(true);

    // Cleanup
    unlinkSync(lockPath);
  });

  it("tryReadInstanceLock returns null for non-existent file", () => {
    const lockPath = join(tmpDir, "nonexistent.lock");
    const result = tryReadInstanceLock(lockPath);
    expect(result).toBeNull();
  });

  it("tryReadInstanceLock returns null for invalid JSON", () => {
    const lockPath = join(tmpDir, "bad.lock");
    writeFileSync(lockPath, "not-json");
    const result = tryReadInstanceLock(lockPath);
    expect(result).toBeNull();
  });
});
