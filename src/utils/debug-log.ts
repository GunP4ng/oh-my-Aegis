const DEBUG = process.env.AEGIS_DEBUG === "1" || process.env.AEGIS_DEBUG === "true";

export function debugLog(tag: string, message: string, error?: unknown): void {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  const errorSuffix = error instanceof Error ? ` | ${error.message}` : error ? ` | ${String(error)}` : "";
  process.stderr.write(`[aegis:${tag}] ${ts} ${message}${errorSuffix}\n`);
}
