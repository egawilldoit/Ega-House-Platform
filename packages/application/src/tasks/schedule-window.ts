import { getLocalWallTimeParts, isIsoDate } from "@ega/domain";

function padCalendarPart(value: number) {
  return String(value).padStart(2, "0");
}

function formatUtcWallDate(valueMs: number) {
  const date = new Date(valueMs);
  return `${date.getUTCFullYear()}-${padCalendarPart(date.getUTCMonth() + 1)}-${padCalendarPart(
    date.getUTCDate(),
  )}T${padCalendarPart(date.getUTCHours())}:${padCalendarPart(date.getUTCMinutes())}`;
}

/**
 * Preserve the block's wall-clock duration while moving it to another local
 * date/time. The returned values are `datetime-local` strings interpreted in
 * the owner's timezone by the canonical schedule validator.
 */
export function buildRescheduledWallWindow(input: {
  currentStartIso: string;
  currentEndIso: string;
  timezone: string;
  targetDate: string;
  targetTime?: string | null;
}): { errorMessage: null; startLocal: string; endLocal: string } | { errorMessage: string } {
  if (!isIsoDate(input.targetDate)) {
    return { errorMessage: "Choose a valid day to move this block." };
  }

  const currentStart = getLocalWallTimeParts(input.currentStartIso, input.timezone);
  const currentEnd = getLocalWallTimeParts(input.currentEndIso, input.timezone);
  if (!currentStart || !currentEnd) {
    return { errorMessage: "Unable to read the scheduled block right now." };
  }

  const targetTime = (input.targetTime ?? "").trim() || currentStart.time;
  if (!/^\d{2}:\d{2}$/.test(targetTime)) {
    return { errorMessage: "Start time must use HH:MM." };
  }

  const startCarrierMs = Date.parse(`${currentStart.date}T${currentStart.time}:00.000Z`);
  const endCarrierMs = Date.parse(`${currentEnd.date}T${currentEnd.time}:00.000Z`);
  const durationMinutes = Math.round((endCarrierMs - startCarrierMs) / 60_000);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return { errorMessage: "The scheduled block is invalid." };
  }

  const targetStartMs = Date.parse(`${input.targetDate}T${targetTime}:00.000Z`);
  if (!Number.isFinite(targetStartMs)) {
    return { errorMessage: "Choose a valid day and time to move this block." };
  }

  return {
    errorMessage: null,
    startLocal: `${input.targetDate}T${targetTime}`,
    endLocal: formatUtcWallDate(targetStartMs + durationMinutes * 60_000),
  };
}
