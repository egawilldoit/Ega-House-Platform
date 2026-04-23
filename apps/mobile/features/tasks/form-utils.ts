export function formatTaskToken(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function formatDateOnlyValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isDateOnlyValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseDateOnlyValue(value: string) {
  if (!isDateOnlyValue(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map((segment) => Number.parseInt(segment, 10));
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function formatDisplayDate(value: string) {
  const parsed = parseDateOnlyValue(value);

  if (!parsed) {
    return 'No due date';
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function validateEstimateMinutesInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return { value: null, error: null } as const;
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      value: null,
      error: 'Estimate must be a whole number of minutes.',
    } as const;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return {
      value: null,
      error: 'Estimate must be a whole number of minutes.',
    } as const;
  }

  if (parsed > 60 * 24 * 365) {
    return {
      value: null,
      error: 'Estimate is too large. Keep it under 525600 minutes.',
    } as const;
  }

  return { value: parsed, error: null } as const;
}
