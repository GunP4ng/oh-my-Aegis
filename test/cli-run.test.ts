import { describe, expect, it } from "bun:test";
import { buildRunMessage } from "../src/cli/run";

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
