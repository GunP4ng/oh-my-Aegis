import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;

function readJsonObject(path: string): JsonObject | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as JsonObject;
  } catch {
    return null;
  }
}

function normalizeInstallSpec(value: string | null | undefined): string | null {
  const spec = typeof value === "string" ? value.trim() : "";
  if (!spec) {
    return null;
  }

  if (
    spec.startsWith("/") ||
    spec.startsWith(".") ||
    spec.startsWith("file:") ||
    spec.startsWith("http:") ||
    spec.startsWith("https:") ||
    /^[A-Za-z]:[\\/]/.test(spec)
  ) {
    return null;
  }

  return spec;
}

export function collectPluginPackageSpecs(entries: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const spec = normalizeInstallSpec(entry);
    if (!spec || seen.has(spec)) {
      continue;
    }
    seen.add(spec);
    out.push(spec);
  }

  return out;
}

function ensurePackageManifest(opencodeDir: string): void {
  const packageJsonPath = join(opencodeDir, "package.json");
  if (existsSync(packageJsonPath)) {
    return;
  }

  writeFileSync(
    packageJsonPath,
    `${JSON.stringify({ name: "opencode-aegis-local", private: true }, null, 2)}\n`,
    "utf-8"
  );
}

function alignManifestDependenciesWithLockfile(opencodeDir: string): void {
  const packageJsonPath = join(opencodeDir, "package.json");
  const packageLockPath = join(opencodeDir, "package-lock.json");
  const manifest = readJsonObject(packageJsonPath);
  const lockfile = readJsonObject(packageLockPath);
  if (!manifest || !lockfile) {
    return;
  }

  const manifestDependencies =
    manifest.dependencies && typeof manifest.dependencies === "object" && !Array.isArray(manifest.dependencies)
      ? (manifest.dependencies as JsonObject)
      : null;
  const packages =
    lockfile.packages && typeof lockfile.packages === "object" && !Array.isArray(lockfile.packages)
      ? (lockfile.packages as JsonObject)
      : null;
  const rootPackage = packages && packages[""] && typeof packages[""] === "object" && !Array.isArray(packages[""])
    ? (packages[""] as JsonObject)
    : null;
  const lockedDependencies =
    rootPackage?.dependencies && typeof rootPackage.dependencies === "object" && !Array.isArray(rootPackage.dependencies)
      ? (rootPackage.dependencies as JsonObject)
      : null;

  if (!manifestDependencies || !lockedDependencies) {
    return;
  }

  let changed = false;
  for (const [name, spec] of Object.entries(lockedDependencies)) {
    if (!Object.prototype.hasOwnProperty.call(manifestDependencies, name)) {
      continue;
    }
    if (typeof spec !== "string" || manifestDependencies[name] === spec) {
      continue;
    }
    manifestDependencies[name] = spec;
    changed = true;
  }

  if (!changed) {
    return;
  }

  manifest.dependencies = manifestDependencies;
  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

export function syncPluginPackages(opencodeDir: string, specs: string[]): string[] {
  const normalized = collectPluginPackageSpecs(specs);
  if (normalized.length === 0) {
    return [];
  }

  ensurePackageManifest(opencodeDir);
  alignManifestDependenciesWithLockfile(opencodeDir);
  execFileSync("npm", ["install", "--prefer-online", ...normalized], {
    cwd: opencodeDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return normalized;
}
