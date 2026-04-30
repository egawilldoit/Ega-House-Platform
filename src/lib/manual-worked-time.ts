export type ManualWorkedTimeInput = {
  startedAt: unknown;
  endedAt: unknown;
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

function parseDateTimeLocal(value: string, label: "From" | "To") {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return {
      error: `${label} must be a valid date and time.`,
      isoValue: null,
    };
  }

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

  if (!startedAt && !endedAt) {
    return { error: null, payload: null };
  }

  if (!startedAt || !endedAt) {
    return {
      error: "Both From and To are required to log worked time.",
      payload: null,
    };
  }

  const startedAtResult = parseDateTimeLocal(startedAt, "From");
  if (startedAtResult.error || !startedAtResult.isoValue) {
    return { error: startedAtResult.error ?? "From is invalid.", payload: null };
  }

  const endedAtResult = parseDateTimeLocal(endedAt, "To");
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
