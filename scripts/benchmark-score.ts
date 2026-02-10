import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseBenchmarkManifest, scoreBenchmark } from "../src/benchmark/scoring";

function main(): void {
  const inputPath = process.argv[2] ?? join(process.cwd(), "benchmarks", "results.json");
  const minPassPerDomain = Number(process.argv[3] ?? "1");

  if (!existsSync(inputPath)) {
    throw new Error(`Benchmark results file not found: ${inputPath}`);
  }

  const raw = readFileSync(inputPath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const manifest = parseBenchmarkManifest(parsed);
  const score = scoreBenchmark(manifest, Number.isFinite(minPassPerDomain) ? minPassPerDomain : 1, {
    evidenceExists: (evidencePath) => {
      const resolvedPath = isAbsolute(evidencePath) ? evidencePath : resolve(process.cwd(), evidencePath);
      return existsSync(resolvedPath);
    },
  });

  process.stdout.write(`${JSON.stringify({ inputPath, score }, null, 2)}\n`);

  if (score.qualityGate.verdict !== "perfect") {
    process.exitCode = 2;
  }
}

main();
