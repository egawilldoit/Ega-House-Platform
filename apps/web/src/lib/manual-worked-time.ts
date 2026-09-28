import { zonedWallTimeToUtcIso } from "@ega/domain/time-context";

export type ManualWorkedTimeInput = {
  startedAt: unknown;
  endedAt: unknown;
  /**
   * IANA timezone (e.g. "Africa/Casablanca") whose wall time the
   * datetime-local inputs are expressed in. Supplied by the caller from the
   * canonical account Time Context — never a numeric browser offset.
   */
  timezone?: unknown;
};

export type ManualWorkedTimePayload = {
  started_at: string;
  ended_at: string;
  duration_seconds: number;
};

export type ManualWorkedTimeValidationResult =
  | {
      error: string;
      payload: null;
    }
  | {
      error: null;
      payload: ManualWorkedTimePayload | null;
    };

function normalizeDateTimeLocalInput(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeTimezone(value: unknown) {
  const normalizedValue = String(value ?? "").trim();
  if (!normalizedValue) {
    return { error: "Worked time timezone is required.", value: null as string | null };
  }
  return { error: null as string | null, value: normalizedValue };
}

function parseDateTimeLocalInTimezone(
  value: string,
  label: "From" | "To",
  timezone: string,
) {
  try {
    return { error: null as string | null, isoValue: zonedWallTimeToUtcIso({ timezone, date: value.slice(0, 10), time: value.slice(11) || "00:00" }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid date and time.";
    return { error: message, isoValue: null as string | null };
  }
}

export function normalizeManualWorkedTimeInput(
  input: ManualWorkedTimeInput,
): ManualWorkedTimeValidationResult {
  const startedAt = normalizeDateTimeLocalInput(input.startedAt);
  const endedAt = normalizeDateTimeLocalInput(input.endedAt);
  const timezoneResult = normalizeTimezone(input.timezone);

  if (!startedAt && !endedAt) {
    return { error: null, payload: null };
  }

  if (!startedAt || !endedAt) {
    return {
      error: "Both From and To are required to log worked time.",
      payload: null,
    };
  }

  if (timezoneResult.error || timezoneResult.value === null) {
    return {
      error: timezoneResult.error ?? "Worked time timezone is required.",
      payload: null,
    };
  }

  const startedAtResult = parseDateTimeLocalInTimezone(startedAt, "From", timezoneResult.value);
  if (startedAtResult.error || !startedAtResult.isoValue) {
    return { error: startedAtResult.error ?? "From is invalid.", payload: null };
  }

  const endedAtResult = parseDateTimeLocalInTimezone(endedAt, "To", timezoneResult.value);
  if (endedAtResult.error || !endedAtResult.isoValue) {
    return { error: endedAtResult.error ?? "To is invalid.", payload: null };
  }

  const startedAtMs = new Date(startedAtResult.isoValue).getTime();
  const endedAtMs = new Date(endedAtResult.isoValue).getTime();

  if (endedAtMs <= startedAtMs) {
    return {
      error: "To must be after From.",
      payload: null,
    };
  }

  return {
    error: null,
    payload: {
      started_at: startedAtResult.isoValue,
      ended_at: endedAtResult.isoValue,
      duration_seconds: Math.floor((endedAtMs - startedAtMs) / 1000),
    },
  };
}
