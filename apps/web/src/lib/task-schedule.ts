import { zonedWallTimeToUtcIso } from "@ega/domain/time-context";

type TaskScheduleInput = {
  scheduledStartAt: unknown;
  scheduledEndAt: unknown;
  /**
   * IANA timezone (e.g. "Africa/Casablanca") whose wall time the
   * datetime-local inputs are expressed in. Supplied by the caller from the
   * canonical account Time Context — never a numeric browser offset.
   */
  timezone?: unknown;
};

type TaskScheduleValidationResult =
  | {
      error: string;
      scheduledStartAtIso: null;
      scheduledEndAtIso: null;
    }
  | {
      error: null;
      scheduledStartAtIso: string | null;
      scheduledEndAtIso: string | null;
    };

function normalizeDateTimeLocalInput(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeTimezone(value: unknown) {
  const normalizedValue = String(value ?? "").trim();
  if (!normalizedValue) {
    return { error: "Schedule timezone is required.", value: null as string | null };
  }
  return { error: null as string | null, value: normalizedValue };
}

function parseDateTimeLocalInTimezone(
  value: string,
  label: "Scheduled start" | "Scheduled end",
  timezone: string,
) {
  try {
    return { error: null as string | null, isoValue: zonedWallTimeToUtcIso({ timezone, date: value.slice(0, 10), time: value.slice(11) || "00:00" }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid date and time.";
    if (message.includes("Invalid IANA timezone")) {
      return { error: "Schedule timezone is invalid.", isoValue: null as string | null };
    }
    if (message.includes("Invalid date") || message.includes("Invalid time")) {
      return { error: `${label} must be a valid date and time.`, isoValue: null as string | null };
    }
    return { error: message, isoValue: null as string | null };
  }
}

export function normalizeTaskScheduleInput(
  input: TaskScheduleInput,
): TaskScheduleValidationResult {
  const scheduledStartAt = normalizeDateTimeLocalInput(input.scheduledStartAt);
  const scheduledEndAt = normalizeDateTimeLocalInput(input.scheduledEndAt);

  if (!scheduledStartAt && !scheduledEndAt) {
    return {
      error: null,
      scheduledStartAtIso: null,
      scheduledEndAtIso: null,
    };
  }

  if (!scheduledStartAt || !scheduledEndAt) {
    return {
      error: "Scheduled start and end are both required for a scheduled task.",
      scheduledStartAtIso: null,
      scheduledEndAtIso: null,
    };
  }

  const timezoneResult = normalizeTimezone(input.timezone);
  if (timezoneResult.error || timezoneResult.value === null) {
    return {
      error: timezoneResult.error ?? "Schedule timezone is required.",
      scheduledStartAtIso: null,
      scheduledEndAtIso: null,
    };
  }

  const parsedStartAt = parseDateTimeLocalInTimezone(
    scheduledStartAt,
    "Scheduled start",
    timezoneResult.value,
  );
  if (parsedStartAt.error || !parsedStartAt.isoValue) {
    return {
      error: parsedStartAt.error ?? "Scheduled start must be a valid date and time.",
      scheduledStartAtIso: null,
      scheduledEndAtIso: null,
    };
  }

  const parsedEndAt = parseDateTimeLocalInTimezone(
    scheduledEndAt,
    "Scheduled end",
    timezoneResult.value,
  );
  if (parsedEndAt.error || !parsedEndAt.isoValue) {
    return {
      error: parsedEndAt.error ?? "Scheduled end must be a valid date and time.",
      scheduledStartAtIso: null,
      scheduledEndAtIso: null,
    };
  }

  if (parsedStartAt.isoValue >= parsedEndAt.isoValue) {
    return {
      error: "Scheduled end must be after scheduled start.",
      scheduledStartAtIso: null,
      scheduledEndAtIso: null,
    };
  }

  return {
    error: null,
    scheduledStartAtIso: parsedStartAt.isoValue,
    scheduledEndAtIso: parsedEndAt.isoValue,
  };
}
