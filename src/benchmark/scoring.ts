import { z } from "zod";

export const BENCHMARK_DOMAINS = ["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC"] as const;

export type BenchmarkDomain = (typeof BENCHMARK_DOMAINS)[number];

const BenchmarkRunSchema = z.object({
  domain: z.enum(BENCHMARK_DOMAINS),
  id: z.string().min(1),
  status: z.enum(["pass", "fail", "skip"]),
  evidence: z.string().min(1).optional(),
  notes: z.string().optional(),
});

const BenchmarkManifestSchema = z.object({
  runs: z.array(BenchmarkRunSchema).default([]),
});

export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;
export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;

export interface DomainScore {
  pass: number;
  fail: number;
  skip: number;
  total: number;
  passRate: number;
}

export interface BenchmarkScore {
  summary: {
    totalRuns: number;
    pass: number;
    fail: number;
    skip: number;
    overallPassRate: number;
  };
  perDomain: Record<BenchmarkDomain, DomainScore>;
  qualityGate: {
    minPassPerDomain: number;
    missingDomains: BenchmarkDomain[];
    missingEvidence: string[];
    verdict: "perfect" | "needs_work";
  };
}

export interface BenchmarkScoreOptions {
  evidenceExists?: (evidencePath: string) => boolean;
}

function emptyDomainScore(): DomainScore {
  return { pass: 0, fail: 0, skip: 0, total: 0, passRate: 0 };
}

export function parseBenchmarkManifest(input: unknown): BenchmarkManifest {
  return BenchmarkManifestSchema.parse(input);
}

export function scoreBenchmark(
  manifest: BenchmarkManifest,
  minPassPerDomain = 1,
  options: BenchmarkScoreOptions = {}
): BenchmarkScore {
  const perDomain = Object.fromEntries(BENCHMARK_DOMAINS.map((domain) => [domain, emptyDomainScore()])) as Record<
    BenchmarkDomain,
    DomainScore
  >;
  const evidenceExists = options.evidenceExists ?? (() => true);

  let pass = 0;
  let fail = 0;
  let skip = 0;
  const missingEvidence: string[] = [];

  for (const run of manifest.runs) {
    const score = perDomain[run.domain];
    score.total += 1;
    if (run.status === "pass") {
      score.pass += 1;
      pass += 1;
    } else if (run.status === "fail") {
      score.fail += 1;
      fail += 1;
    } else {
      score.skip += 1;
      skip += 1;
    }

    if (run.status === "skip") {
      continue;
    }

    const evidencePath = run.evidence?.trim() ?? "";
    if (!evidencePath) {
      missingEvidence.push(`${run.domain}/${run.id}: missing evidence path`);
      continue;
    }
    if (!evidenceExists(evidencePath)) {
      missingEvidence.push(`${run.domain}/${run.id}: evidence not found (${evidencePath})`);
    }
  }

  for (const domain of BENCHMARK_DOMAINS) {
    const score = perDomain[domain];
    const considered = score.pass + score.fail;
    score.passRate = considered === 0 ? 0 : score.pass / considered;
  }

  const totalRuns = manifest.runs.length;
  const consideredTotal = pass + fail;
  const overallPassRate = consideredTotal === 0 ? 0 : pass / consideredTotal;
  const missingDomains = BENCHMARK_DOMAINS.filter((domain) => perDomain[domain].pass < minPassPerDomain);

  return {
    summary: {
      totalRuns,
      pass,
      fail,
      skip,
      overallPassRate,
    },
    perDomain,
    qualityGate: {
      minPassPerDomain,
      missingDomains,
      missingEvidence,
      verdict: missingDomains.length === 0 && missingEvidence.length === 0 ? "perfect" : "needs_work",
    },
  };
}
