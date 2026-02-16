import { z } from "zod";
export declare const BENCHMARK_DOMAINS: readonly ["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC"];
export type BenchmarkDomain = (typeof BENCHMARK_DOMAINS)[number];
declare const BenchmarkRunSchema: z.ZodObject<{
    domain: z.ZodEnum<{
        WEB_API: "WEB_API";
        WEB3: "WEB3";
        PWN: "PWN";
        REV: "REV";
        CRYPTO: "CRYPTO";
        FORENSICS: "FORENSICS";
        MISC: "MISC";
    }>;
    id: z.ZodString;
    status: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
        skip: "skip";
    }>;
    evidence: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const BenchmarkManifestSchema: z.ZodObject<{
    runs: z.ZodDefault<z.ZodArray<z.ZodObject<{
        domain: z.ZodEnum<{
            WEB_API: "WEB_API";
            WEB3: "WEB3";
            PWN: "PWN";
            REV: "REV";
            CRYPTO: "CRYPTO";
            FORENSICS: "FORENSICS";
            MISC: "MISC";
        }>;
        id: z.ZodString;
        status: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
            skip: "skip";
        }>;
        evidence: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
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
export declare function parseBenchmarkManifest(input: unknown): BenchmarkManifest;
export declare function scoreBenchmark(manifest: BenchmarkManifest, minPassPerDomain?: number, options?: BenchmarkScoreOptions): BenchmarkScore;
export {};
