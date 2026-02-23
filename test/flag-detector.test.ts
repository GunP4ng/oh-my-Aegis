import { describe, expect, it } from "bun:test";
import { clearCandidates, scanForFlags } from "../src/orchestration/flag-detector";

describe("flag-detector", () => {
  it("downgrades fake/placeholder flags to low confidence", () => {
    clearCandidates();
    const found = scanForFlags("flag{FAKE_FLAG_FOR_TEST}", "unit");
    expect(found.length).toBe(1);
    expect(found[0]?.confidence).toBe("low");
  });

  it("keeps realistic compact flags at high confidence", () => {
    clearCandidates();
    const found = scanForFlags("flag{real_candidate_123}", "unit");
    expect(found.length).toBe(1);
    expect(found[0]?.confidence).toBe("high");
  });
});
