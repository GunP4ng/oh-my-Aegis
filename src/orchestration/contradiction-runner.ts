export interface ContradictionRunnerInput {
  hypothesis: string;
  expected: string[];
  observedOutput: string;
  expectedExitCode?: number;
  observedExitCode?: number;
}

export interface ContradictionRunnerResult {
  contradictory: boolean;
  matchedExpected: string[];
  missingExpected: string[];
  exitCodeMismatch: boolean;
  summary: string;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function runContradictionRunner(input: ContradictionRunnerInput): ContradictionRunnerResult {
  const observed = normalize(input.observedOutput);
  const expected = input.expected.map((item) => item.trim()).filter((item) => item.length > 0);
  const matchedExpected = expected.filter((item) => observed.includes(normalize(item)));
  const missingExpected = expected.filter((item) => !observed.includes(normalize(item)));

  const exitCodeMismatch =
    typeof input.expectedExitCode === "number" &&
    typeof input.observedExitCode === "number" &&
    input.expectedExitCode !== input.observedExitCode;

  const contradictory = missingExpected.length > 0 || exitCodeMismatch;
  const summaryParts: string[] = [
    `hypothesis=${input.hypothesis || "(none)"}`,
    `matched=${matchedExpected.length}/${expected.length}`,
  ];
  if (missingExpected.length > 0) {
    summaryParts.push(`missing=${missingExpected.join(" | ")}`);
  }
  if (exitCodeMismatch) {
    summaryParts.push(`exit_code_mismatch expected=${input.expectedExitCode} observed=${input.observedExitCode}`);
  }

  return {
    contradictory,
    matchedExpected,
    missingExpected,
    exitCodeMismatch,
    summary: summaryParts.join("; "),
  };
}
