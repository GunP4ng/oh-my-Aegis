import { describe, expect, it } from "bun:test";
import { OrchestratorConfigSchema } from "../src/config/schema";
import { DEFAULT_STATE } from "../src/state/types";
import { mergeLoadSkills, resolveAutoloadSkills } from "../src/skills/autoload";

describe("skills/autoload", () => {
  const config = OrchestratorConfigSchema.parse({});
  const available = new Set<string>([
    "ctf-solver",
    "plan-writing",
    "systematic-debugging",
    "top-web-vulnerabilities",
    "ethical-hacking-methodology",
    "vulnerability-scanner",
    "idor-testing",
  ]);

  it("selects CTF SCAN WEB_API skills", () => {
    const state = { ...DEFAULT_STATE, mode: "CTF" as const, phase: "SCAN" as const, targetType: "WEB_API" as const };
    const skills = resolveAutoloadSkills({ state, config, subagentType: "ctf-web", availableSkills: available });
    expect(skills).toEqual(["top-web-vulnerabilities"]);
  });

  it("selects CTF SCAN PWN skills", () => {
    const state = { ...DEFAULT_STATE, mode: "CTF" as const, phase: "SCAN" as const, targetType: "PWN" as const };
    const skills = resolveAutoloadSkills({ state, config, subagentType: "ctf-pwn", availableSkills: available });
    expect(skills).toEqual(["ctf-solver"]);
  });

  it("selects CTF EXECUTE WEB_API skills", () => {
    const state = {
      ...DEFAULT_STATE,
      mode: "CTF" as const,
      phase: "EXECUTE" as const,
      targetType: "WEB_API" as const,
    };
    const skills = resolveAutoloadSkills({ state, config, subagentType: "aegis-exec", availableSkills: available });
    expect(skills).toEqual(["idor-testing", "systematic-debugging"]);
  });

  it("selects BOUNTY EXECUTE UNKNOWN skills", () => {
    const state = {
      ...DEFAULT_STATE,
      mode: "BOUNTY" as const,
      phase: "EXECUTE" as const,
      targetType: "UNKNOWN" as const,
    };
    const skills = resolveAutoloadSkills({ state, config, subagentType: "bounty-triage", availableSkills: available });
    expect(skills).toEqual(["vulnerability-scanner"]);
  });

  it("merges user skills first and caps total", () => {
    const merged = mergeLoadSkills({
      existing: ["playwright", "systematic-debugging"],
      autoload: ["idor-testing", "systematic-debugging"],
      maxSkills: 2,
      availableSkills: available,
    });
    expect(merged).toEqual(["playwright", "systematic-debugging"]);
  });
});
