export type ManualWorkedTimeInput = {
  startedAt: unknown;
  endedAt: unknown;
  timeZoneOffsetMinutes?: unknown;
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

function normalizeTimezoneOffsetMinutes(value: unknown) {
  const normalizedValue = String(value ?? "").trim();

  if (!normalizedValue) {
    return {
      error: "Worked time timezone offset is required.",
      value: null,
    };
  }

  if (!/^-?\d+$/.test(normalizedValue)) {
    return {
      error: "Worked time timezone offset is invalid.",
      value: null,
    };
  }

  const offsetMinutes = Number(normalizedValue);
  if (!Number.isSafeInteger(offsetMinutes)) {
    return {
      error: "Worked time timezone offset is invalid.",
      value: null,
    };
  }

  return {
    error: null,
    value: offsetMinutes,
  };
}

function parseDateTimeLocal(
  value: string,
  label: "From" | "To",
  timeZoneOffsetMinutes: number,
) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!match) {
    return {
      error: `${label} must be a valid date and time.`,
      isoValue: null,
    };
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
    return {
      error: `${label} must be a valid date and time.`,
      isoValue: null,
    };
  }

  const localCandidateMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const localCandidate = new Date(localCandidateMs);

  if (Number.isNaN(localCandidate.getTime())) {
    return {
      error: `${label} must be a valid date and time.`,
      isoValue: null,
    };
  }

  if (
    localCandidate.getUTCFullYear() !== year ||
    localCandidate.getUTCMonth() !== month - 1 ||
    localCandidate.getUTCDate() !== day ||
    localCandidate.getUTCHours() !== hour ||
    localCandidate.getUTCMinutes() !== minute ||
    localCandidate.getUTCSeconds() !== second
  ) {
    return {
      error: `${label} must be a valid date and time.`,
      isoValue: null,
    };
  }

  const parsed = new Date(localCandidateMs + timeZoneOffsetMinutes * 60_000);

  return {
    error: null,
    isoValue: parsed.toISOString(),
  };
}

export function normalizeManualWorkedTimeInput(
  input: ManualWorkedTimeInput,
): ManualWorkedTimeValidationResult {
  const startedAt = normalizeDateTimeLocalInput(input.startedAt);
  const endedAt = normalizeDateTimeLocalInput(input.endedAt);
  const timeZoneOffsetResult = normalizeTimezoneOffsetMinutes(
    input.timeZoneOffsetMinutes,
  );

  if (!startedAt && !endedAt) {
    return { error: null, payload: null };
  }

  if (!startedAt || !endedAt) {
    return {
      error: "Both From and To are required to log worked time.",
      payload: null,
    };
  }

  if (timeZoneOffsetResult.error || timeZoneOffsetResult.value === null) {
    return {
      error: timeZoneOffsetResult.error ?? "Worked time timezone offset is invalid.",
      payload: null,
    };
  }

  const startedAtResult = parseDateTimeLocal(
    startedAt,
    "From",
    timeZoneOffsetResult.value,
  );
  if (startedAtResult.error || !startedAtResult.isoValue) {
    return { error: startedAtResult.error ?? "From is invalid.", payload: null };
  }

  const endedAtResult = parseDateTimeLocal(
    endedAt,
    "To",
    timeZoneOffsetResult.value,
  );
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
