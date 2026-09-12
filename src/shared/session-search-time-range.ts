import type { Result } from "@openclaw/normalization-core/result";

/** Timestamp window shared by tool, Gateway, embedded, and transcript-search inputs. */
type SessionSearchTimeRange = {
  minTimestampMs?: number;
  beforeTimestampMs?: number;
};

export function parseSessionSearchTimeRange(input: {
  minTimestampMs?: unknown;
  beforeTimestampMs?: unknown;
}): Result<SessionSearchTimeRange, string> {
  const range: SessionSearchTimeRange = {};
  for (const key of ["minTimestampMs", "beforeTimestampMs"] as const) {
    const value = input[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      return { ok: false, error: `${key} must be a non-negative safe integer in milliseconds` };
    }
    range[key] = value;
  }
  if (
    range.minTimestampMs !== undefined &&
    range.beforeTimestampMs !== undefined &&
    range.minTimestampMs >= range.beforeTimestampMs
  ) {
    return { ok: false, error: "minTimestampMs must be less than beforeTimestampMs" };
  }
  return { ok: true, value: range };
}
