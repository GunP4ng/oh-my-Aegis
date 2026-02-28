import { describe, expect, it } from "bun:test";
import { parseOracleProgressFromText } from "../src/orchestration/parse-oracle-progress";

describe("parseOracleProgressFromText", () => {
  it("parses strict ORACLE_PROGRESS marker", () => {
    const parsed = parseOracleProgressFromText(
      "ORACLE_PROGRESS pass_count=3 fail_index=3 total_tests=10"
    );
    expect(parsed).toEqual({ passCount: 3, failIndex: 3, totalTests: 10 });
  });

  it("parses tolerant key-value fallback", () => {
    const parsed = parseOracleProgressFromText("progress: pass=5 fail_index=7 total=12");
    expect(parsed).toEqual({ passCount: 5, failIndex: 7, totalTests: 12 });
  });

  it("parses pass/total fallback", () => {
    const parsed = parseOracleProgressFromText("checker summary: pass 4 / total 9");
    expect(parsed).toEqual({ passCount: 4, failIndex: 4, totalTests: 9 });
  });

  it("uses fail_index=-1 when pass equals total in fallback", () => {
    const parsed = parseOracleProgressFromText("pass 7/total 7");
    expect(parsed).toEqual({ passCount: 7, failIndex: -1, totalTests: 7 });
  });

  it("returns null when marker is missing", () => {
    expect(parseOracleProgressFromText("no progress line here")).toBeNull();
  });
});
