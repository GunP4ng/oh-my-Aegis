import { describe, expect, it } from "bun:test";
import { buildRunEnv, buildRunMessage, parseRunArgs, validatePassthroughCommand } from "../src/cli/run";

describe("cli run message builder", () => {
  it("injects MODE header when missing", () => {
    const message = buildRunMessage({
      mode: "CTF",
      ultrawork: false,
      message: "solve this challenge",
    });

    expect(message.startsWith("MODE: CTF")).toBe(true);
  });

  it("does not override existing MODE header", () => {
    const message = buildRunMessage({
      mode: "BOUNTY",
      ultrawork: false,
      message: "MODE: CTF\nexisting message",
    });

    expect(message.startsWith("MODE: CTF")).toBe(true);
  });

  it("injects ultrawork keyword when requested", () => {
    const message = buildRunMessage({
      mode: "BOUNTY",
      ultrawork: true,
      message: "triage this target",
    });

    expect(message.startsWith("ulw")).toBe(true);
  });
});

describe("cli run arg parsing", () => {
  it("parses god mode aliases", () => {
    const parsed = parseRunArgs(["--god-mode", "hello there"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.godMode).toBe(true);

    const parsedAlias = parseRunArgs(["--unsafe-full-permission", "hello there"]);
    expect(parsedAlias.ok).toBe(true);
    if (!parsedAlias.ok) {
      return;
    }
    expect(parsedAlias.value.godMode).toBe(true);
  });

  it("builds spawned env with AEGIS_GOD_MODE only when requested", () => {
    const base = { PATH: "/tmp/bin" };
    expect(buildRunEnv(base, false)).toBe(base);
    expect(buildRunEnv(base, true)).toEqual({
      PATH: "/tmp/bin",
      AEGIS_GOD_MODE: "1",
    });
  });
});

describe("cli run passthrough validation", () => {
  it("rejects ctf tool names in --command passthrough", () => {
    const error = validatePassthroughCommand(["--command", "ctf_orch_status"]);
    expect(typeof error).toBe("string");
    expect(error?.includes("Invalid --command target")).toBe(true);
  });

  it("rejects aegis tool names in --command= passthrough", () => {
    const error = validatePassthroughCommand(["--command=aegis_memory_search"]);
    expect(typeof error).toBe("string");
    expect(error?.includes("Invalid --command target")).toBe(true);
  });

  it("allows non-tool slash command passthrough", () => {
    const error = validatePassthroughCommand(["--command", "help"]);
    expect(error).toBeNull();
  });
});
