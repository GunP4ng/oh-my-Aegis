import { describe, expect, it } from "bun:test";
import { listPatterns, matchPatterns } from "../src/orchestration/pattern-matcher";

describe("pattern matcher", () => {
  it("includes WEB3 and MISC pattern inventories", () => {
    const web3 = listPatterns("WEB3");
    const misc = listPatterns("MISC");
    expect(web3.length).toBeGreaterThan(0);
    expect(misc.length).toBeGreaterThan(0);
  });

  it("matches WEB3 reentrancy/oracle signals", () => {
    const text =
      "smart contract has external call before state update, fallback callback reentrancy, and oracle twap manipulation";
    const matches = matchPatterns(text, "WEB3");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.patternId === "web3-reentrancy" || m.patternId === "web3-oracle-manipulation")).toBe(true);
  });

  it("matches MISC osint/encoding signals", () => {
    const text = "osint timeline pivot with archive metadata and multi-stage base64 hex gzip decoding";
    const matches = matchPatterns(text, "MISC");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.patternId === "misc-osint-pivot" || m.patternId === "misc-encoding-chain")).toBe(true);
  });
});
