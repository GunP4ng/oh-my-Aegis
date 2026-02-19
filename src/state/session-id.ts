export function normalizeSessionID(sessionID: string): string {
  const normalized = sessionID.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 64);
  return normalized.length > 0 ? normalized : "session";
}
