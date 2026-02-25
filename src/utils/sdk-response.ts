import { isRecord } from "./is-record";

export function hasErrorResponse(result: unknown): boolean {
  if (!isRecord(result)) {
    return false;
  }
  return Boolean(result.error);
}
