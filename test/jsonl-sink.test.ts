import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendJsonlRecord,
  appendJsonlRecords,
  rotateJsonlIfNeeded,
  JSONL_MAX_SIZE_BYTES,
} from "../src/orchestration/jsonl-sink";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `jsonl-sink-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe("jsonl-sink rotation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it("rotates when file size exceeds 2MB", () => {
    const filePath = join(tmpDir, "test.jsonl");
    // Write a file just at/over the limit
    const bigContent = Buffer.alloc(JSONL_MAX_SIZE_BYTES, "x");
    writeFileSync(filePath, bigContent);

    rotateJsonlIfNeeded(filePath);

    // The original file should have been rotated to .1
    expect(existsSync(`${filePath}.1`)).toBe(true);
    // The original path no longer exists
    expect(existsSync(filePath)).toBe(false);
  });

  it("does not rotate when file size is under 2MB", () => {
    const filePath = join(tmpDir, "test.jsonl");
    writeFileSync(filePath, '{"small": true}\n');

    rotateJsonlIfNeeded(filePath);

    // The original file should still be there
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(`${filePath}.1`)).toBe(false);
  });

  it("chains .1 -> .2 -> .3 on multiple rotations, no .4 created", () => {
    const filePath = join(tmpDir, "chain.jsonl");
    const bigContent = Buffer.alloc(JSONL_MAX_SIZE_BYTES, "a");

    // First rotation: base -> .1
    writeFileSync(filePath, bigContent);
    rotateJsonlIfNeeded(filePath);
    expect(existsSync(`${filePath}.1`)).toBe(true);
    expect(existsSync(`${filePath}.2`)).toBe(false);

    // Second rotation: .1 -> .2, base -> .1
    writeFileSync(filePath, bigContent);
    rotateJsonlIfNeeded(filePath);
    expect(existsSync(`${filePath}.1`)).toBe(true);
    expect(existsSync(`${filePath}.2`)).toBe(true);
    expect(existsSync(`${filePath}.3`)).toBe(false);

    // Third rotation: .2 -> .3, .1 -> .2, base -> .1
    writeFileSync(filePath, bigContent);
    rotateJsonlIfNeeded(filePath);
    expect(existsSync(`${filePath}.1`)).toBe(true);
    expect(existsSync(`${filePath}.2`)).toBe(true);
    expect(existsSync(`${filePath}.3`)).toBe(true);
    expect(existsSync(`${filePath}.4`)).toBe(false);

    // Fourth rotation: old .3 is deleted (overwritten by .2 -> .3), .2 -> .3, .1 -> .2, base -> .1
    // No .4 should ever exist
    writeFileSync(filePath, bigContent);
    rotateJsonlIfNeeded(filePath);
    expect(existsSync(`${filePath}.4`)).toBe(false);
    expect(existsSync(`${filePath}.3`)).toBe(true);
  });

  it("appendJsonlRecord triggers rotation when over 2MB", () => {
    const filePath = join(tmpDir, "record.jsonl");
    const bigContent = Buffer.alloc(JSONL_MAX_SIZE_BYTES, "r");
    writeFileSync(filePath, bigContent);

    appendJsonlRecord(filePath, { key: "value" });

    // Rotation happened: old content is now in .1
    expect(existsSync(`${filePath}.1`)).toBe(true);
    // New record is in the base file
    expect(existsSync(filePath)).toBe(true);
    const content = require("node:fs").readFileSync(filePath, "utf-8");
    expect(content).toContain('"key":"value"');
  });

  it("appendJsonlRecords triggers rotation when over 2MB", () => {
    const filePath = join(tmpDir, "records.jsonl");
    const bigContent = Buffer.alloc(JSONL_MAX_SIZE_BYTES, "s");
    writeFileSync(filePath, bigContent);

    appendJsonlRecords(filePath, [{ a: 1 }, { b: 2 }]);

    // Rotation happened
    expect(existsSync(`${filePath}.1`)).toBe(true);
    // New records are in the base file
    expect(existsSync(filePath)).toBe(true);
    const content = require("node:fs").readFileSync(filePath, "utf-8");
    expect(content).toContain('"a":1');
    expect(content).toContain('"b":2');
  });

  it("does nothing if file does not exist", () => {
    const filePath = join(tmpDir, "nonexistent.jsonl");
    // Should not throw
    expect(() => rotateJsonlIfNeeded(filePath)).not.toThrow();
    expect(existsSync(`${filePath}.1`)).toBe(false);
  });
});
