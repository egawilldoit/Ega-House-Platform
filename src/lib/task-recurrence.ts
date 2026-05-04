export const TASK_RECURRENCE_RULE_VALUES = [
  "daily",
  "weekdays",
  "weekly:sunday",
  "weekly:monday",
  "weekly:tuesday",
  "weekly:wednesday",
  "weekly:thursday",
  "weekly:friday",
  "weekly:saturday",
  "monthly:day-of-month",
] as const;

export type TaskRecurrenceRule = (typeof TASK_RECURRENCE_RULE_VALUES)[number];

export const DEFAULT_TASK_RECURRENCE_TIMEZONE = "UTC";

const WEEKDAY_INDEX_BY_RULE: Record<string, number> = {
  "weekly:sunday": 0,
  "weekly:monday": 1,
  "weekly:tuesday": 2,
  "weekly:wednesday": 3,
  "weekly:thursday": 4,
  "weekly:friday": 5,
  "weekly:saturday": 6,
};

export function isTaskRecurrenceRule(value: string): value is TaskRecurrenceRule {
  return TASK_RECURRENCE_RULE_VALUES.includes(value as TaskRecurrenceRule);
}

export function normalizeTaskRecurrenceRuleInput(value: unknown) {
  const rule = String(value ?? "").trim().toLowerCase();

  if (!rule) {
    return {
      errorMessage: null,
      rule: null,
    };
  }

  if (!isTaskRecurrenceRule(rule)) {
    return {
      errorMessage: "Recurring preset is not supported.",
      rule: null,
    };
  }

  return {
    errorMessage: null,
    rule,
  };
}

export function isValidTaskRecurrenceAnchorDate(value: string) {
  return parseDateOnly(value) !== null;
}

export function normalizeTaskRecurrenceAnchorDateInput(
  value: unknown,
  fallbackDate: string,
) {
  const anchorDate = String(value ?? "").trim() || fallbackDate;

  if (!anchorDate || !isValidTaskRecurrenceAnchorDate(anchorDate)) {
    return {
      anchorDate: null,
      errorMessage: "Recurring anchor date is invalid.",
    };
  }

  return {
    anchorDate,
    errorMessage: null,
  };
}

export function isValidTaskRecurrenceTimezone(value: string) {
  if (!value || value.length > 128) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTaskRecurrenceTimezoneInput(value: unknown) {
  const timezone = String(value ?? "").trim() || DEFAULT_TASK_RECURRENCE_TIMEZONE;

  if (!isValidTaskRecurrenceTimezone(timezone)) {
    return {
      errorMessage: "Recurring timezone is invalid.",
      timezone: null,
    };
  }

  return {
    errorMessage: null,
    timezone,
  };
}

export function normalizeTaskRecurrenceScheduleInput(input: {
  rule: unknown;
  anchorDate?: unknown;
  timezone?: unknown;
  fallbackAnchorDate: string;
}) {
  const ruleResult = normalizeTaskRecurrenceRuleInput(input.rule);
  if (ruleResult.errorMessage) {
    return { errorMessage: ruleResult.errorMessage, schedule: null };
  }

  if (!ruleResult.rule) {
    return { errorMessage: null, schedule: null };
  }

  const anchorDateResult = normalizeTaskRecurrenceAnchorDateInput(
    input.anchorDate,
    input.fallbackAnchorDate,
  );
  if (anchorDateResult.errorMessage || !anchorDateResult.anchorDate) {
    return { errorMessage: anchorDateResult.errorMessage, schedule: null };
  }

  const timezoneResult = normalizeTaskRecurrenceTimezoneInput(input.timezone);
  if (timezoneResult.errorMessage || !timezoneResult.timezone) {
    return { errorMessage: timezoneResult.errorMessage, schedule: null };
  }

  const nextOccurrenceDate = getNextTaskRecurrenceDate(
    ruleResult.rule,
    anchorDateResult.anchorDate,
  );
  if (!nextOccurrenceDate) {
    return {
      errorMessage: "Recurring next occurrence date is invalid.",
      schedule: null,
    };
  }

  return {
    errorMessage: null,
    schedule: {
      rule: ruleResult.rule,
      anchorDate: anchorDateResult.anchorDate,
      timezone: timezoneResult.timezone,
      nextOccurrenceDate,
    },
  };
}

export function formatTaskRecurrenceRule(rule: string | null | undefined) {
  if (!rule) {
    return "Does not repeat";
  }

  if (rule === "daily") {
    return "Daily";
  }

  if (rule === "weekdays") {
    return "Weekdays";
  }

  if (rule === "monthly:day-of-month") {
    return "Monthly";
  }

  if (rule.startsWith("weekly:")) {
    const weekday = rule.slice("weekly:".length);
    return `Weekly ${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`;
  }

  return rule;
}

function parseDateOnly(value: string) {
  const [yearPart, monthPart, dayPart] = value.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);

  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function lastDayOfUtcMonth(year: number, zeroBasedMonth: number) {
  return new Date(Date.UTC(year, zeroBasedMonth + 1, 0)).getUTCDate();
}

export function getNextTaskRecurrenceDate(rule: TaskRecurrenceRule, fromDate: string) {
  const date = parseDateOnly(fromDate);
  if (!date) {
    return null;
  }

  if (rule === "daily") {
    return toIsoDate(addUtcDays(date, 1));
  }

  if (rule === "weekdays") {
    let next = addUtcDays(date, 1);
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
      next = addUtcDays(next, 1);
    }
    return toIsoDate(next);
  }

  if (rule === "monthly:day-of-month") {
    const originalDay = date.getUTCDate();
    const nextMonth = date.getUTCMonth() + 1;
    const nextYear = date.getUTCFullYear() + Math.floor(nextMonth / 12);
    const normalizedNextMonth = nextMonth % 12;
    const day = Math.min(originalDay, lastDayOfUtcMonth(nextYear, normalizedNextMonth));
    return toIsoDate(new Date(Date.UTC(nextYear, normalizedNextMonth, day)));
  }

  const targetWeekday = WEEKDAY_INDEX_BY_RULE[rule];
  if (targetWeekday === undefined) {
    return null;
  }

  const currentWeekday = date.getUTCDay();
  const daysUntilTarget = (targetWeekday - currentWeekday + 7) % 7 || 7;
  return toIsoDate(addUtcDays(date, daysUntilTarget));
}
