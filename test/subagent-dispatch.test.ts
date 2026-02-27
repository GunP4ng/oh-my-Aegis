import { describe, expect, it } from "bun:test";
import { planExploreDispatch, planLibrarianDispatch } from "../src/orchestration/subagent-dispatch";
import { DEFAULT_STATE, type SessionState } from "../src/state/types";

function makeState(overrides?: Partial<SessionState>): SessionState {
  return {
    ...DEFAULT_STATE,
    mode: "CTF",
    alternatives: [],
    recentEvents: [],
    failureReasonCounts: { ...DEFAULT_STATE.failureReasonCounts },
    dispatchHealthBySubagent: {},
    modelHealthByModel: {},
    ...overrides,
  };
}

function getPromptLine(prompt: string, prefix: string): string {
  const line = prompt
    .split("\n")
    .find((item) => item.startsWith(prefix));
  return line ?? "";
}

describe("subagent-dispatch prompt contracts", () => {
  it("enforces UniqueFocus/DoNotCover headers across explore tracks", () => {
    const state = makeState({ mode: "CTF" });
    const plan = planExploreDispatch(state, "analyze suspicious auth flow");

    expect(plan.tracks).toHaveLength(3);
    expect(plan.tracks.every((track) => track.prompt.startsWith("UniqueFocus: "))).toBe(true);
    expect(plan.tracks.every((track) => track.prompt.includes("\nDoNotCover: "))).toBe(true);

    const uniqueFocusLines = plan.tracks.map((track) => getPromptLine(track.prompt, "UniqueFocus: "));
    const doNotCoverLines = plan.tracks.map((track) => getPromptLine(track.prompt, "DoNotCover: "));

    expect(new Set(uniqueFocusLines).size).toBe(plan.tracks.length);
    expect(new Set(doNotCoverLines).size).toBe(plan.tracks.length);

    const byPurpose = new Map(plan.tracks.map((track) => [track.purpose, track.prompt]));

    const surfaceMapPrompt = byPurpose.get("aegis-explore-surface-map") ?? "";
    expect(surfaceMapPrompt).toContain("UniqueFocus: surface map: file list, entrypoints, protections, top hotspots");
    expect(surfaceMapPrompt).toContain("DoNotCover: ");
    expect(surfaceMapPrompt).toContain("vuln-patterns");
    expect(surfaceMapPrompt).toContain("evidence-cut");
    expect(surfaceMapPrompt).toContain("forbid deep sink analysis and ranking/triage summarization");

    const vulnPatternsPrompt = byPurpose.get("aegis-explore-vuln-patterns") ?? "";
    expect(vulnPatternsPrompt).toContain(
      "UniqueFocus: security patterns: sinks, trust boundaries, validation/authz/authn issues"
    );
    expect(vulnPatternsPrompt).toContain("surface-map");
    expect(vulnPatternsPrompt).toContain("evidence-cut");
    expect(vulnPatternsPrompt).toContain("forbid broad inventory and ranking/triage summarization");

    const evidenceCutPrompt = byPurpose.get("aegis-explore-evidence-cut") ?? "";
    expect(evidenceCutPrompt).toContain(
      "UniqueFocus: evidence cut: dedupe + rank findings by exploitability/confidence + top 5"
    );
    expect(evidenceCutPrompt).toContain("surface-map");
    expect(evidenceCutPrompt).toContain("vuln-patterns");
    expect(evidenceCutPrompt).toContain("forbid new searching and only synthesize existing findings");
  });

  it("enforces type-specific UniqueFocus/DoNotCover headers across librarian tracks", () => {
    const state = makeState({ mode: "CTF" });
    const plan = planLibrarianDispatch(state, "oauth token replay risk", {
      searchTypes: ["cve", "writeup", "docs", "github"],
      maxTracks: 4,
    });

    expect(plan.tracks).toHaveLength(4);
    expect(plan.tracks.every((track) => track.prompt.startsWith("UniqueFocus: "))).toBe(true);
    expect(plan.tracks.every((track) => track.prompt.includes("\nDoNotCover: "))).toBe(true);

    const byPurpose = new Map(plan.tracks.map((track) => [track.purpose, track.prompt]));

    expect(byPurpose.get("aegis-librarian-cve")).toContain(
      "UniqueFocus: cve intelligence: CVEs, advisories, and applicability to the query"
    );
    expect(byPurpose.get("aegis-librarian-cve")).toContain("DoNotCover: Do not cover writeup/docs/github librarian tracks");

    expect(byPurpose.get("aegis-librarian-writeup")).toContain(
      "UniqueFocus: writeup intelligence: similar incident/CTF writeups with actionable methods"
    );
    expect(byPurpose.get("aegis-librarian-writeup")).toContain("DoNotCover: Do not cover cve/docs/github librarian tracks");

    expect(byPurpose.get("aegis-librarian-docs")).toContain(
      "UniqueFocus: documentation intelligence: official docs and version-specific security guidance"
    );
    expect(byPurpose.get("aegis-librarian-docs")).toContain("DoNotCover: Do not cover cve/writeup/github librarian tracks");

    expect(byPurpose.get("aegis-librarian-github")).toContain(
      "UniqueFocus: github intelligence: OSS examples, issues, and security discussions"
    );
    expect(byPurpose.get("aegis-librarian-github")).toContain("DoNotCover: Do not cover cve/writeup/docs librarian tracks");

    for (const prompt of byPurpose.values()) {
      expect(prompt).toContain("do not perform local code exploration");
    }
  });
});
