type CorrectionDraft = {
  date: string;
  startTime: string;
  endTime: string;
};

type CorrectionPreview =
  | {
      errorMessage: string;
      data: null;
    }
  | {
      errorMessage: null;
      data: {
        startedAtIso: string;
        endedAtIso: string;
        durationSeconds: number;
      };
    };

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

export function toLocalDateInputValue(iso: string) {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return "";
  }

  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

export function toLocalTimeInputValue(iso: string) {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return "";
  }

  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

export function combineLocalDateAndTimeToIso(dateValue: string, timeValue: string) {
  const normalizedDate = dateValue.trim();
  const normalizedTime = timeValue.trim();

  if (!normalizedDate || !normalizedTime) {
    return null;
  }

  const localDate = new Date(`${normalizedDate}T${normalizedTime}`);
  if (Number.isNaN(localDate.getTime())) {
    return null;
  }

  return localDate.toISOString();
}

export function shiftLocalTimeValue(timeValue: string, deltaMinutes: number) {
  const normalized = timeValue.trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) {
    return timeValue;
  }

  const [hoursPart, minutesPart] = normalized.split(":");
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return timeValue;
  }

  const totalMinutes = Math.min(
    23 * 60 + 59,
    Math.max(0, hours * 60 + minutes + deltaMinutes),
  );
  const nextHours = Math.floor(totalMinutes / 60);
  const nextMinutes = totalMinutes % 60;
  return `${pad2(nextHours)}:${pad2(nextMinutes)}`;
}

export function getTimerCorrectionPreview(draft: CorrectionDraft): CorrectionPreview {
  if (!draft.date.trim()) {
    return { errorMessage: "Date is required.", data: null };
  }
  if (!draft.startTime.trim()) {
    return { errorMessage: "Start time is required.", data: null };
  }
  if (!draft.endTime.trim()) {
    return { errorMessage: "End time is required.", data: null };
  }

  const startedAtIso = combineLocalDateAndTimeToIso(draft.date, draft.startTime);
  const endedAtIso = combineLocalDateAndTimeToIso(draft.date, draft.endTime);

  if (!startedAtIso || !endedAtIso) {
    return { errorMessage: "Date and time values are invalid.", data: null };
  }

  const startedAtMs = new Date(startedAtIso).getTime();
  const endedAtMs = new Date(endedAtIso).getTime();

  if (endedAtMs < startedAtMs) {
    return { errorMessage: "End time must be after start time.", data: null };
  }

  return {
    errorMessage: null,
    data: {
      startedAtIso,
      endedAtIso,
      durationSeconds: Math.floor((endedAtMs - startedAtMs) / 1000),
    },
  };
}
