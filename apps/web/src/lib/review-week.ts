function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getTodayIsoDate() {
  return toIsoDate(new Date());
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && toIsoDate(parsed) === value;
}

export function getWeekBounds(weekOf: string) {
  const parsed = new Date(`${weekOf}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const day = parsed.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const weekStart = new Date(parsed);
  weekStart.setUTCDate(parsed.getUTCDate() + diffToMonday);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  return {
    weekStart: toIsoDate(weekStart),
    weekEnd: toIsoDate(weekEnd),
  };
}

export function getWeekWindow(weekStart: string, weekEnd: string) {
  const startIso = `${weekStart}T00:00:00.000Z`;
  const endExclusiveDate = new Date(`${weekEnd}T00:00:00.000Z`);
  endExclusiveDate.setUTCDate(endExclusiveDate.getUTCDate() + 1);

  return {
    startIso,
    endExclusiveIso: `${toIsoDate(endExclusiveDate)}T00:00:00.000Z`,
  };
}

export function shiftIsoDateByDays(isoDate: string, days: number) {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toIsoDate(parsed);
}

export function formatIsoDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(isoDateTime: string) {
  return new Date(isoDateTime).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
