import { describe, expect, it } from "bun:test";
import { generateLinearRecoveryScript, recoverLinear } from "../src/orchestration/rev-toolkit";

describe("rev-toolkit linear recovery guardrails", () => {
  it("emits missing-file guardrails", () => {
    const script = generateLinearRecoveryScript("/tmp/dumps", 4, 3);

    expect(script).toContain("Missing dump file");
    expect(script).toContain("Ensure per-bin out/expected buffers are dumped before running recovery.");
  });

  it("emits empty-dump and length-mismatch guardrails", () => {
    const script = generateLinearRecoveryScript("/tmp/dumps", 4, 3);

    expect(script).toContain("Empty dump file");
    expect(script).toContain("Each bin needs non-zero out/expected data for recovery.");
    expect(script).toContain("Length mismatch for bin");
    expect(script).toContain("Re-dump both operands from the same compare site so lengths match.");
  });

  it("emits degenerate-pair detection guardrail", () => {
    const script = generateLinearRecoveryScript("/tmp/dumps", 4, 3);

    expect(script).toContain("if out_data == exp_data:");
    expect(script).toContain("Degenerate dump pairs detected");
    expect(script).toContain("out_data == exp_data");
  });

  it("emits base255 zero-byte guardrail for recovered real_arg", () => {
    const script = generateLinearRecoveryScript("/tmp/dumps", 4, 3);

    expect(script).toContain("Invalid base255 input");
    expect(script).toContain("0x00");
    expect(script).toContain("if any(b == 0 for b in real_arg):");
  });

  it("recoverLinear throws on out/expected length mismatch", () => {
    const params = {
      multiplier: 3,
      inverseMultiplier: 171,
      modulus: 256,
    };

    expect(() => recoverLinear(new Uint8Array([1]), new Uint8Array([1, 2]), params)).toThrow(
      "Length mismatch"
    );
  });
});
