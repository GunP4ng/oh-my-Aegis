import { describe, expect, it } from "bun:test";
import { parseScopeMarkdown } from "../src/bounty/scope-policy";

describe("scope policy", () => {
  it("extracts allow/deny hosts conservatively by section", () => {
    const md = [
      "# Program Scope",
      "기준 도메인: example.com",
      "",
      "## 범위 내 타깃",
      "| Domain | 대상 |",
      "|---|---|",
      "| Domain | a.example.com |",
      "| Domain | *.sub.example.com |",
      "",
      "## 범위 외 타깃",
      "- out.example.com",
      "- *.blocked.com",
      "",
      "노이즈: not-a-host, 1234",
    ].join("\n");

    const policy = parseScopeMarkdown(md, "test", 0);
    expect(policy.allowedHostsExact).toContain("example.com");
    expect(policy.allowedHostsExact).toContain("a.example.com");
    expect(policy.allowedHostsSuffix).toContain("sub.example.com");
    expect(policy.deniedHostsExact).toContain("out.example.com");
    expect(policy.deniedHostsSuffix).toContain("blocked.com");
    expect(policy.allowedHostsExact).not.toContain("not-a-host");
  });

  it("extracts Korean blackout windows", () => {
    const md = "매주 목요일 00:00 ~ 11:00는 정기점검 시간";
    const policy = parseScopeMarkdown(md, "test", 0);
    expect(policy.blackoutWindows.length).toBeGreaterThan(0);
    expect(policy.blackoutWindows[0]?.day).toBe(4);
  });
});
