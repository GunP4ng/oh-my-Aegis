import { readFileSync } from "node:fs";
import { join } from "node:path";

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

interface CommitEntry {
  hash: string;
  subject: string;
}

function resolveReleaseRef(): string {
  const ref = process.env.AEGIS_RELEASE_REF?.trim();
  return ref && ref.length > 0 ? ref : "HEAD";
}

function resolveBaseTagOverride(): string | null {
  const tag = process.env.AEGIS_RELEASE_BASE_TAG?.trim();
  return tag && tag.length > 0 ? tag : null;
}

function ensureGitRef(ref: string, label: string): void {
  const result = runGit(["rev-parse", "--verify", ref]);
  if (!result.ok) {
    throw new Error(`Unknown ${label} '${ref}'`);
  }
}

function runGit(args: string[]): GitResult {
  const proc = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: proc.exitCode === 0,
    stdout: (proc.stdout ? new TextDecoder().decode(proc.stdout) : "").trim(),
    stderr: (proc.stderr ? new TextDecoder().decode(proc.stderr) : "").trim(),
    code: proc.exitCode,
  };
}

function readPackageVersion(): string {
  const raw = readFileSync(join(process.cwd(), "package.json"), "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("package.json root must be object");
  }
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new Error("package.json version is missing");
  }
  return version;
}

function latestTag(ref: string): string | null {
  const result = runGit(["describe", "--tags", "--abbrev=0", ref]);
  if (!result.ok || result.stdout.length === 0) {
    return null;
  }
  return result.stdout;
}

function isGitRepository(): boolean {
  const result = runGit(["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.stdout.toLowerCase() === "true";
}

function collectCommits(baseTag: string | null, releaseRef: string): CommitEntry[] {
  const range = baseTag ? `${baseTag}..${releaseRef}` : releaseRef;
  const args = ["log", range, "--pretty=format:%h%x09%s"];

  const result = runGit(args);
  if (!result.ok) {
    return [];
  }
  if (!result.stdout) {
    return [];
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [hash, ...rest] = line.split("\t");
      return {
        hash,
        subject: rest.join("\t").trim(),
      };
    })
    .filter((entry) => entry.hash.length > 0 && entry.subject.length > 0);
}

function sectionForSubject(subject: string): string {
  const normalized = subject.toLowerCase();
  if (/^feat(\(.+\))?!?:/.test(normalized)) return "Features";
  if (/^fix(\(.+\))?!?:/.test(normalized)) return "Fixes";
  if (/^perf(\(.+\))?!?:/.test(normalized)) return "Performance";
  if (/^refactor(\(.+\))?!?:/.test(normalized)) return "Refactors";
  if (/^docs(\(.+\))?!?:/.test(normalized)) return "Docs";
  if (/^test(\(.+\))?!?:/.test(normalized)) return "Tests";
  if (/^(build|chore|ci)(\(.+\))?!?:/.test(normalized)) return "Chores";
  return "Other";
}

function groupCommits(commits: CommitEntry[]): Record<string, CommitEntry[]> {
  const grouped: Record<string, CommitEntry[]> = {
    Features: [],
    Fixes: [],
    Performance: [],
    Refactors: [],
    Docs: [],
    Tests: [],
    Chores: [],
    Other: [],
  };

  for (const commit of commits) {
    grouped[sectionForSubject(commit.subject)].push(commit);
  }
  return grouped;
}

function render(
  version: string,
  releaseRef: string,
  baseTag: string | null,
  commits: CommitEntry[],
  gitAvailable: boolean,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const grouped = groupCommits(commits);
  const lines: string[] = [];
  lines.push(`# Release v${version}`);
  lines.push("");
  lines.push(`Date: ${today}`);
  lines.push(`Repository history available: ${gitAvailable ? "yes" : "no"}`);
  lines.push(`Release ref: ${releaseRef}`);
  lines.push(baseTag ? `Base tag: ${baseTag}` : "Base tag: (none)");
  lines.push("");

  if (commits.length === 0) {
    lines.push(gitAvailable ? "- No commits found since last tag." : "- Git history not available in current environment.");
    lines.push("");
    return lines.join("\n");
  }

  const order: Array<keyof typeof grouped> = [
    "Features",
    "Fixes",
    "Performance",
    "Refactors",
    "Docs",
    "Tests",
    "Chores",
    "Other",
  ];

  for (const section of order) {
    const entries = grouped[section];
    if (entries.length === 0) {
      continue;
    }
    lines.push(`## ${section}`);
    for (const entry of entries) {
      lines.push(`- ${entry.subject} (${entry.hash})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function main(): void {
  const version = readPackageVersion();
  const gitAvailable = isGitRepository();
  const releaseRef = resolveReleaseRef();
  const baseTagOverride = resolveBaseTagOverride();

  if (gitAvailable) {
    ensureGitRef(releaseRef, "release ref");
    if (baseTagOverride) {
      ensureGitRef(baseTagOverride, "base tag");
    }
  }

  const tag = gitAvailable ? (baseTagOverride ?? latestTag(releaseRef)) : null;
  const commits = gitAvailable ? collectCommits(tag, releaseRef) : [];
  process.stdout.write(`${render(version, releaseRef, tag, commits, gitAvailable)}\n`);
}

main();
