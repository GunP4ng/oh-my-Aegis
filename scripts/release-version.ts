import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type BumpType = "major" | "minor" | "patch";

interface PackageJson {
  version: string;
  [key: string]: unknown;
}

interface ReleaseVersionResult {
  previousVersion: string;
  nextVersion: string;
  bump: BumpType | "override";
}

function parseSemver(input: string): [number, number, number] | null {
  const match = input.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function bumpVersion(version: string, bump: BumpType): string {
  const parsed = parseSemver(version);
  if (!parsed) {
    throw new Error(`Invalid semver version in package.json: '${version}'`);
  }
  const [major, minor, patch] = parsed;
  if (bump === "major") {
    return `${major + 1}.0.0`;
  }
  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function readPackageJson(path: string): PackageJson {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("package.json root must be an object");
  }
  const pkg = parsed as PackageJson;
  if (typeof pkg.version !== "string") {
    throw new Error("package.json is missing string 'version'");
  }
  return pkg;
}

function resolveInputs(argv: string[]): {
  bump: BumpType;
  overrideVersion: string | null;
  plain: boolean;
} {
  const args = argv.slice(2);
  const plain = args.includes("--plain");
  const bumpArg = (process.env.BUMP ?? args.find((item) => !item.startsWith("--")) ?? "patch").toLowerCase();
  const versionArg = process.env.VERSION ?? null;

  if (versionArg && !parseSemver(versionArg)) {
    throw new Error(`Invalid VERSION override '${versionArg}'. Expected semver (x.y.z).`);
  }

  if (!["major", "minor", "patch"].includes(bumpArg)) {
    throw new Error(`Invalid bump '${bumpArg}'. Use major, minor, or patch.`);
  }

  return {
    bump: bumpArg as BumpType,
    overrideVersion: versionArg,
    plain,
  };
}

function main(): void {
  const packagePath = join(process.cwd(), "package.json");
  const pkg = readPackageJson(packagePath);
  const { bump, overrideVersion, plain } = resolveInputs(process.argv);

  const previousVersion = pkg.version;
  const nextVersion = overrideVersion ?? bumpVersion(previousVersion, bump);
  if (previousVersion === nextVersion) {
    throw new Error(`Release version did not change (still ${previousVersion}).`);
  }

  pkg.version = nextVersion;
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");

  const result: ReleaseVersionResult = {
    previousVersion,
    nextVersion,
    bump: overrideVersion ? "override" : bump,
  };

  if (plain) {
    process.stdout.write(`${nextVersion}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
