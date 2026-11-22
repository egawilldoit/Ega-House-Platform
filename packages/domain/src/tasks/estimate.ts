export const TASK_ESTIMATE_MAX_MINUTES = 60 * 24 * 365;

export function normalizeTaskEstimateInput(rawValue: unknown) {
  const value = String(rawValue ?? "").trim();

  if (!value) {
    return {
      value: null,
      error: null,
    } as const;
  }

  if (!/^\d+$/.test(value)) {
    return {
      value: null,
      error: "Estimate must be a whole number of minutes.",
    } as const;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return {
      value: null,
      error: "Estimate must be a whole number of minutes.",
    } as const;
  }

  if (parsed > TASK_ESTIMATE_MAX_MINUTES) {
    return {
      value: null,
      error: "Estimate is too large. Keep it under 525600 minutes.",
    } as const;
  }

  return {
    value: parsed,
    error: null,
  } as const;
}
