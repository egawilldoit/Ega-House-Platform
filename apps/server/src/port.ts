export const DEFAULT_PORT = 3001;

/**
 * Resolve the listening port from an env value.
 *
 * Accepts only integers between 1 and 65535; anything else (missing, NaN,
 * fractional, out of range) falls back to the default port instead of
 * crashing or binding to an unintended value.
 */
export function resolvePort(
  raw: string | undefined,
  fallback: number = DEFAULT_PORT,
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}
