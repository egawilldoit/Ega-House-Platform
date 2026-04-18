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

  if (parsed > 60 * 24 * 365) {
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

export function formatTaskEstimate(minutes: number | null | undefined) {
  if (!Number.isFinite(minutes) || minutes === null || minutes === undefined) {
    return null;
  }

  const safeMinutes = Math.max(0, Math.floor(minutes));

  if (safeMinutes === 0) {
    return "0m";
  }

  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}
