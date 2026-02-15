function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function extractErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    return error.message || String(error);
  }

  if (isRecord(error)) {
    const candidates: unknown[] = [
      error,
      error.error,
      error.data,
      isRecord(error.data) ? (error.data as Record<string, unknown>).error : null,
    ];
    for (const item of candidates) {
      if (!item) continue;
      if (typeof item === "string" && item.trim().length > 0) {
        return item;
      }
      if (item instanceof Error) {
        return item.message || String(item);
      }
      if (isRecord(item)) {
        const msg = item.message;
        if (typeof msg === "string" && msg.trim().length > 0) {
          return msg;
        }
        const text = item.text;
        if (typeof text === "string" && text.trim().length > 0) {
          return text;
        }
      }
    }
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function extractMessageIndexFromError(error: unknown): number | null {
  const message = extractErrorMessage(error);
  const match = message.match(/messages\.(\d+)/i);
  if (!match) return null;
  const value = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(value) ? value : null;
}
