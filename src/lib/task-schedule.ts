type TaskScheduleInput = {
  scheduledStartAt: unknown;
  scheduledEndAt: unknown;
  timezoneOffsetMinutes?: unknown;
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

function normalizeTimezoneOffsetMinutes(value: unknown) {
  const normalizedValue = String(value ?? "").trim();
  if (!normalizedValue) {
    return { error: "Schedule timezone offset is required.", value: null };
  }

  if (!/^-?\d+$/.test(normalizedValue)) {
    return { error: "Schedule timezone offset is invalid.", value: null };
  }

  const offsetMinutes = Number(normalizedValue);
  if (!Number.isSafeInteger(offsetMinutes)) {
    return { error: "Schedule timezone offset is invalid.", value: null };
  }

  return { error: null, value: offsetMinutes };
}

function parseDateTimeLocal(
  value: string,
  label: "Scheduled start" | "Scheduled end",
  timeZoneOffsetMinutes: number,
) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!match) {
    return { error: `${label} must be a valid date and time.`, isoValue: null };
  }

  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue = "00"] =
    match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return { error: `${label} must be a valid date and time.`, isoValue: null };
  }

  const localCandidateMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const localCandidate = new Date(localCandidateMs);

  if (Number.isNaN(localCandidate.getTime())) {
    return { error: `${label} must be a valid date and time.`, isoValue: null };
  }

  if (
    localCandidate.getUTCFullYear() !== year ||
    localCandidate.getUTCMonth() !== month - 1 ||
    localCandidate.getUTCDate() !== day ||
    localCandidate.getUTCHours() !== hour ||
    localCandidate.getUTCMinutes() !== minute ||
    localCandidate.getUTCSeconds() !== second
  ) {
    return { error: `${label} must be a valid date and time.`, isoValue: null };
  }

  const parsed = new Date(localCandidateMs + timeZoneOffsetMinutes * 60_000);
  return { error: null, isoValue: parsed.toISOString() };
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

  const timezoneOffsetResult = normalizeTimezoneOffsetMinutes(input.timezoneOffsetMinutes);
  if (timezoneOffsetResult.error || timezoneOffsetResult.value === null) {
    return {
      error: timezoneOffsetResult.error ?? "Schedule timezone offset is invalid.",
      scheduledStartAtIso: null,
      scheduledEndAtIso: null,
    };
  }

  const parsedStartAt = parseDateTimeLocal(
    scheduledStartAt,
    "Scheduled start",
    timezoneOffsetResult.value,
  );
  if (parsedStartAt.error || !parsedStartAt.isoValue) {
    return {
      error: parsedStartAt.error ?? "Scheduled start must be a valid date and time.",
      scheduledStartAtIso: null,
      scheduledEndAtIso: null,
    };
  }

  const parsedEndAt = parseDateTimeLocal(
    scheduledEndAt,
    "Scheduled end",
    timezoneOffsetResult.value,
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
