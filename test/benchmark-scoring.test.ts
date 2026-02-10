import { describe, expect, it } from "bun:test";
import { parseBenchmarkManifest, scoreBenchmark } from "../src/benchmark/scoring";

describe("benchmark scoring", () => {
  it("marks verdict perfect when each domain has required pass count", () => {
    const manifest = parseBenchmarkManifest({
      runs: [
        { domain: "WEB_API", id: "1", status: "pass", evidence: "benchmarks/evidence/web_api/1.json" },
        { domain: "WEB3", id: "2", status: "pass", evidence: "benchmarks/evidence/web3/2.json" },
        { domain: "PWN", id: "3", status: "pass", evidence: "benchmarks/evidence/pwn/3.json" },
        { domain: "REV", id: "4", status: "pass", evidence: "benchmarks/evidence/rev/4.json" },
        { domain: "CRYPTO", id: "5", status: "pass", evidence: "benchmarks/evidence/crypto/5.json" },
        { domain: "FORENSICS", id: "6", status: "pass", evidence: "benchmarks/evidence/forensics/6.json" },
        { domain: "MISC", id: "7", status: "pass", evidence: "benchmarks/evidence/misc/7.json" },
      ],
    });

    const score = scoreBenchmark(manifest, 1, { evidenceExists: () => true });
    expect(score.qualityGate.verdict).toBe("perfect");
    expect(score.qualityGate.missingDomains.length).toBe(0);
    expect(score.qualityGate.missingEvidence.length).toBe(0);
  });

  it("marks missing domains when pass count requirement is not met", () => {
    const manifest = parseBenchmarkManifest({
      runs: [
        { domain: "WEB_API", id: "1", status: "pass", evidence: "benchmarks/evidence/web_api/1.json" },
        { domain: "PWN", id: "2", status: "fail", evidence: "benchmarks/evidence/pwn/2.json" },
      ],
    });

    const score = scoreBenchmark(manifest, 1, { evidenceExists: () => true });
    expect(score.qualityGate.verdict).toBe("needs_work");
    expect(score.qualityGate.missingDomains).toContain("PWN");
    expect(score.qualityGate.missingDomains).toContain("WEB3");
    expect(score.qualityGate.missingEvidence.length).toBe(0);
  });

  it("marks verdict needs_work when non-skip run has no evidence", () => {
    const manifest = parseBenchmarkManifest({
      runs: [
        { domain: "WEB_API", id: "1", status: "pass" },
        { domain: "WEB3", id: "2", status: "skip" },
      ],
    });

    const score = scoreBenchmark(manifest, 1, { evidenceExists: () => true });
    expect(score.qualityGate.verdict).toBe("needs_work");
    expect(score.qualityGate.missingEvidence.length).toBe(1);
    expect(score.qualityGate.missingEvidence[0]).toContain("WEB_API/1");
  });
});
