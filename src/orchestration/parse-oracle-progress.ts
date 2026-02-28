export interface ParsedOracleProgress {
  passCount: number;
  failIndex: number;
  totalTests: number;
}

function toInt(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(passCount: number, failIndex: number, totalTests: number): ParsedOracleProgress | null {
  if (passCount < 0 || totalTests < 0) return null;
  if (failIndex < -1) return null;
  return { passCount, failIndex, totalTests };
}

export function parseOracleProgressFromText(raw: string): ParsedOracleProgress | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  const strict =
    /ORACLE_PROGRESS\s+pass_count\s*=\s*(-?\d+)\s+fail_index\s*=\s*(-?\d+)\s+total_tests\s*=\s*(-?\d+)/i.exec(
      raw
    );
  if (strict) {
    const passCount = toInt(strict[1]);
    const failIndex = toInt(strict[2]);
    const totalTests = toInt(strict[3]);
    if (passCount === null || failIndex === null || totalTests === null) return null;
    return normalize(passCount, failIndex, totalTests);
  }

  const fallbackKeyValue =
    /\bpass\s*=\s*(-?\d+)\b[^\n\r]*?\bfail_index\s*=\s*(-?\d+)\b[^\n\r]*?\btotal\s*=\s*(-?\d+)\b/i.exec(
      raw
    );
  if (fallbackKeyValue) {
    const passCount = toInt(fallbackKeyValue[1]);
    const failIndex = toInt(fallbackKeyValue[2]);
    const totalTests = toInt(fallbackKeyValue[3]);
    if (passCount === null || failIndex === null || totalTests === null) return null;
    return normalize(passCount, failIndex, totalTests);
  }

  const fallbackFraction = /\bpass\s*[:=]?\s*(-?\d+)\s*\/\s*(?:total\s*[:=]?\s*)?(-?\d+)\b/i.exec(raw);
  if (fallbackFraction) {
    const passCount = toInt(fallbackFraction[1]);
    const totalTests = toInt(fallbackFraction[2]);
    if (passCount === null || totalTests === null) return null;
    const failIndex = totalTests > 0 && passCount >= totalTests ? -1 : Math.max(0, passCount);
    return normalize(passCount, failIndex, totalTests);
  }

  return null;
}
