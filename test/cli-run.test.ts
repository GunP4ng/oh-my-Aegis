import { describe, expect, it } from "bun:test";
import { buildRunMessage, validatePassthroughCommand } from "../src/cli/run";

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
