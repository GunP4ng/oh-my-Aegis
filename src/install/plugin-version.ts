const NPM_REGISTRY_BASE = "https://registry.npmjs.org/";
const DEFAULT_TIMEOUT_MS = 5_000;
const PRIORITIZED_TAGS = ["latest", "beta", "next"] as const;

export interface FetchNpmDistTagsOptions {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export async function fetchNpmDistTags(
  packageName: string,
  options?: FetchNpmDistTagsOptions
): Promise<Record<string, string> | null> {
  const normalized = packageName.trim();
  if (!normalized) return null;

  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const encoded = encodeURIComponent(normalized);
    const res = await fetchImpl(`${NPM_REGISTRY_BASE}${encoded}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { "dist-tags"?: unknown };
    const tags = body["dist-tags"];
    if (!tags || typeof tags !== "object" || Array.isArray(tags)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [tag, value] of Object.entries(tags)) {
      if (typeof value === "string" && value.trim().length > 0) {
        out[tag] = value;
      }
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolvePluginEntryWithVersion(
  packageName: string,
  currentVersion: string,
  options?: FetchNpmDistTagsOptions
): Promise<string> {
  const pkg = packageName.trim();
  const version = currentVersion.trim();
  if (!pkg && !version) return "";
  if (!pkg) return version;
  if (!version) return pkg;

  const distTags = await fetchNpmDistTags(pkg, options);
  if (distTags) {
    const preferred = [...PRIORITIZED_TAGS, ...Object.keys(distTags)];
    const seen = new Set<string>();
    for (const tag of preferred) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      if (distTags[tag] === version) {
        return `${pkg}@${tag}`;
      }
    }
  }

  return `${pkg}@${version}`;
}
