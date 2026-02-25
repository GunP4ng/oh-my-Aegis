export interface ParityRunnerInput {
  localOutput?: string;
  dockerOutput?: string;
  remoteOutput?: string;
}

export interface ParityPairDiff {
  pair: string;
  match: boolean;
  leftHash: string;
  rightHash: string;
}

export interface ParityRunnerResult {
  ok: boolean;
  checkedPairs: number;
  diffs: ParityPairDiff[];
  summary: string;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function miniHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function runParityRunner(input: ParityRunnerInput): ParityRunnerResult {
  const values: Array<{ label: string; value: string }> = [];
  if (typeof input.localOutput === "string" && input.localOutput.trim().length > 0) {
    values.push({ label: "local", value: normalize(input.localOutput) });
  }
  if (typeof input.dockerOutput === "string" && input.dockerOutput.trim().length > 0) {
    values.push({ label: "docker", value: normalize(input.dockerOutput) });
  }
  if (typeof input.remoteOutput === "string" && input.remoteOutput.trim().length > 0) {
    values.push({ label: "remote", value: normalize(input.remoteOutput) });
  }

  const diffs: ParityPairDiff[] = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const left = values[i];
      const right = values[j];
      diffs.push({
        pair: `${left.label}-${right.label}`,
        match: left.value === right.value,
        leftHash: miniHash(left.value),
        rightHash: miniHash(right.value),
      });
    }
  }

  const ok = diffs.length > 0 && diffs.every((item) => item.match);
  const summary =
    diffs.length === 0
      ? "Parity runner requires at least 2 non-empty outputs."
      : ok
        ? `Parity matched across ${diffs.length} pair(s).`
        : `Parity mismatch detected across ${diffs.filter((item) => !item.match).length}/${diffs.length} pair(s).`;

  return {
    ok,
    checkedPairs: diffs.length,
    diffs,
    summary,
  };
}
