export interface ScanSnapshot {
  id: string;
  timestamp: number;
  target: string;
  assets: string[];
  findings: string[];
  templateSet: string;
}

export interface DeltaResult {
  newAssets: string[];
  removedAssets: string[];
  newFindings: string[];
  resolvedFindings: string[];
  templateChanged: boolean;
  summary: string;
}

const scanHistory: Map<string, ScanSnapshot[]> = new Map();

function normalizeKey(target: string): string {
  return target.trim().toLowerCase();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function summarizeDelta(delta: Omit<DeltaResult, "summary">): string {
  const parts = [
    `newAssets=${delta.newAssets.length}`,
    `removedAssets=${delta.removedAssets.length}`,
    `newFindings=${delta.newFindings.length}`,
    `resolvedFindings=${delta.resolvedFindings.length}`,
    `templateChanged=${delta.templateChanged ? "yes" : "no"}`,
  ];
  return `Delta: ${parts.join(", ")}`;
}

/**
 * Save a scan snapshot in memory for a target.
 */
export function saveScanSnapshot(snapshot: ScanSnapshot): void {
  const key = normalizeKey(snapshot.target);
  if (!key) {
    return;
  }

  const entry: ScanSnapshot = {
    ...snapshot,
    target: snapshot.target.trim(),
    assets: uniqueSorted(snapshot.assets),
    findings: uniqueSorted(snapshot.findings),
    templateSet: snapshot.templateSet.trim(),
  };

  const existing = scanHistory.get(key) ?? [];
  existing.push(entry);
  existing.sort((a, b) => a.timestamp - b.timestamp);
  scanHistory.set(key, existing);
}

/**
 * Get the latest scan snapshot for a target.
 */
export function getLatestSnapshot(target: string): ScanSnapshot | null {
  const history = scanHistory.get(normalizeKey(target));
  if (!history || history.length === 0) {
    return null;
  }
  return history[history.length - 1] ?? null;
}

/**
 * Compute added/removed assets and findings between snapshots.
 */
export function computeDelta(previous: ScanSnapshot, current: ScanSnapshot): DeltaResult {
  const previousAssets = new Set(uniqueSorted(previous.assets));
  const currentAssets = new Set(uniqueSorted(current.assets));
  const previousFindings = new Set(uniqueSorted(previous.findings));
  const currentFindings = new Set(uniqueSorted(current.findings));

  const newAssets = [...currentAssets].filter((asset) => !previousAssets.has(asset));
  const removedAssets = [...previousAssets].filter((asset) => !currentAssets.has(asset));
  const newFindings = [...currentFindings].filter((finding) => !previousFindings.has(finding));
  const resolvedFindings = [...previousFindings].filter((finding) => !currentFindings.has(finding));
  const templateChanged = previous.templateSet.trim() !== current.templateSet.trim();

  const deltaWithoutSummary = {
    newAssets: newAssets.sort((a, b) => a.localeCompare(b)),
    removedAssets: removedAssets.sort((a, b) => a.localeCompare(b)),
    newFindings: newFindings.sort((a, b) => a.localeCompare(b)),
    resolvedFindings: resolvedFindings.sort((a, b) => a.localeCompare(b)),
    templateChanged,
  };

  return {
    ...deltaWithoutSummary,
    summary: summarizeDelta(deltaWithoutSummary),
  };
}

/**
 * Return all known snapshots for a target.
 */
export function getScanHistory(target: string): ScanSnapshot[] {
  const history = scanHistory.get(normalizeKey(target));
  if (!history) {
    return [];
  }
  return [...history];
}

/**
 * Build a summary describing scan deltas versus the previous snapshot.
 */
export function buildDeltaSummary(target: string, current: ScanSnapshot): string {
  const history = getScanHistory(target);
  if (history.length === 0) {
    return `No previous snapshot found for ${target}. Current snapshot ${current.id} is treated as baseline.`;
  }

  const latest = history[history.length - 1];
  const previous = latest && latest.id === current.id ? history[history.length - 2] : latest;
  if (!previous) {
    return `No prior snapshot before ${current.id} for ${target}. Current snapshot is baseline.`;
  }

  const delta = computeDelta(previous, current);
  const detailParts: string[] = [];
  if (delta.newAssets.length > 0) {
    detailParts.push(`New assets: ${delta.newAssets.join(", ")}`);
  }
  if (delta.removedAssets.length > 0) {
    detailParts.push(`Removed assets: ${delta.removedAssets.join(", ")}`);
  }
  if (delta.newFindings.length > 0) {
    detailParts.push(`New findings: ${delta.newFindings.join(", ")}`);
  }
  if (delta.resolvedFindings.length > 0) {
    detailParts.push(`Resolved findings: ${delta.resolvedFindings.join(", ")}`);
  }
  if (delta.templateChanged) {
    detailParts.push(`Template set changed: ${previous.templateSet} -> ${current.templateSet}`);
  }

  const details = detailParts.length > 0 ? `\n${detailParts.join("\n")}` : "\nNo material changes detected.";
  return `Target ${target} delta from ${previous.id} to ${current.id}: ${delta.summary}${details}`;
}

/**
 * Determine whether a target should be rescanned.
 */
export function shouldRescan(target: string, templateSet: string, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  const latest = getLatestSnapshot(target);
  if (!latest) {
    return true;
  }

  if (latest.templateSet.trim() !== templateSet.trim()) {
    return true;
  }

  if (maxAgeMs <= 0) {
    return true;
  }

  const ageMs = Date.now() - latest.timestamp;
  return ageMs >= maxAgeMs;
}
