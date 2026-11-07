import type { UserPreferences } from "@ega/domain/preferences";

/**
 * Presentation rules for the personal schedule.
 *
 * Everything here is derived from the values loaded from the durable
 * `personalOperations` record. The planner, summary strip and check panel are
 * display-only: they never create timers, notifications or extra requests.
 */

export type Schedule = UserPreferences["personalOperations"];
export type GuidanceBlock = Schedule["guidance"][number];

export const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Day = (typeof DAYS)[number];

export const DAY_LABELS: Readonly<Record<Day, string>> = Object.freeze({
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
});

const WEEKDAY_INDEX: Readonly<Record<string, number>> = Object.freeze({
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
});

/** Parses the stored `HH:mm` form. Returns null for anything the domain rejects. */
export function parseTimeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `2850` -> `47.5h`; `2880` -> `48h`. Deliberately not rounded to whole hours. */
export function formatHours(totalMinutes: number): string {
  return `${Number((Math.max(0, totalMinutes) / 60).toFixed(1))}h`;
}

/** `90` -> `1h 30m`; `45` -> `45m`; `120` -> `2h`. */
export function formatDuration(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

export type WeeklyTotals = Readonly<{ work: number; jobSearch: number }>;

export function getWeeklyTotals(schedule: Schedule): WeeklyTotals {
  return DAYS.reduce<WeeklyTotals>(
    (totals, day) => ({
      work: totals.work + Math.max(0, schedule.targets[day].work),
      jobSearch: totals.jobSearch + Math.max(0, schedule.targets[day].jobSearch),
    }),
    { work: 0, jobSearch: 0 },
  );
}

export function getTargetSeries(
  schedule: Schedule,
  field: keyof Schedule["targets"][Day],
): Readonly<Record<Day, number>> {
  return DAYS.reduce<Record<Day, number>>(
    (series, day) => {
      series[day] = schedule.targets[day][field];
      return series;
    },
    {
      monday: 0,
      tuesday: 0,
      wednesday: 0,
      thursday: 0,
      friday: 0,
      saturday: 0,
      sunday: 0,
    },
  );
}

function hasValidRange(block: GuidanceBlock): boolean {
  const start = parseTimeToMinutes(block.start);
  const end = parseTimeToMinutes(block.end);
  return start !== null && end !== null && end > start;
}

export type GuidanceConflicts = Readonly<{
  /** `${guidanceIndex}:${day}` keys for blocks that cannot be drawn safely. */
  badKeys: ReadonlySet<string>;
  messages: readonly string[];
}>;

/**
 * Finds invalid ranges and enabled overlaps using the same rule as the
 * domain validator: back-to-back blocks are allowed, only true overlaps fail.
 */
export function getGuidanceConflicts(guidance: readonly GuidanceBlock[]): GuidanceConflicts {
  const badKeys = new Set<string>();
  const messages: string[] = [];

  for (const [index, block] of guidance.entries()) {
    const start = parseTimeToMinutes(block.start);
    const end = parseTimeToMinutes(block.end);
    if (start === null || end === null) {
      for (const day of block.days) badKeys.add(`${index}:${day}`);
      messages.push(`${block.name}: start and end must be valid times.`);
    } else if (end <= start) {
      for (const day of block.days) badKeys.add(`${index}:${day}`);
      messages.push(`${block.name}: end must be after start.`);
    }
  }

  for (const day of DAYS) {
    const enabled = guidance
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.enabled && block.days.includes(day) && hasValidRange(block));

    for (let left = 0; left < enabled.length; left += 1) {
      for (let right = left + 1; right < enabled.length; right += 1) {
        const first = enabled[left];
        const second = enabled[right];
        if (!first || !second) continue;
        const firstStart = parseTimeToMinutes(first.block.start);
        const firstEnd = parseTimeToMinutes(first.block.end);
        const secondStart = parseTimeToMinutes(second.block.start);
        const secondEnd = parseTimeToMinutes(second.block.end);
        if (
          firstStart === null ||
          firstEnd === null ||
          secondStart === null ||
          secondEnd === null
        ) {
          continue;
        }
        if (firstStart < secondEnd && secondStart < firstEnd) {
          badKeys.add(`${first.index}:${day}`);
          badKeys.add(`${second.index}:${day}`);
          messages.push(
            `${first.block.name} and ${second.block.name} overlap on ${DAY_LABELS[day]}.`,
          );
        }
      }
    }
  }

  return { badKeys, messages: [...new Set(messages)] };
}

export function getPlannedGuidanceMinutes(
  guidance: readonly GuidanceBlock[],
): Readonly<Record<Day, number>> {
  return DAYS.reduce<Record<Day, number>>(
    (planned, day) => {
      planned[day] = guidance
        .filter((block) => block.enabled && block.days.includes(day))
        .reduce((total, block) => {
          const start = parseTimeToMinutes(block.start);
          const end = parseTimeToMinutes(block.end);
          return start !== null && end !== null && end > start
            ? total + (end - start)
            : total;
        }, 0);
      return planned;
    },
    {
      monday: 0,
      tuesday: 0,
      wednesday: 0,
      thursday: 0,
      friday: 0,
      saturday: 0,
      sunday: 0,
    },
  );
}

export type PlannerRange = Readonly<{ startHour: number; endHour: number }>;

/**
 * The visible hour window always covers every valid stored block. It never
 * clips an out-of-hours entry and still keeps a sensible default window for a
 * schedule with no guidance.
 */
export function getPlannerRange(guidance: readonly GuidanceBlock[]): PlannerRange {
  let startMinutes = 6 * 60;
  let endMinutes = 22 * 60;

  for (const block of guidance) {
    const start = parseTimeToMinutes(block.start);
    const end = parseTimeToMinutes(block.end);
    if (start !== null) startMinutes = Math.min(startMinutes, start);
    if (end !== null) endMinutes = Math.max(endMinutes, end);
  }

  const startHour = Math.max(0, Math.min(23, Math.floor(startMinutes / 60)));
  const endHour = Math.min(24, Math.max(startHour + 1, Math.ceil(endMinutes / 60)));
  return { startHour, endHour };
}

export type ZonedClock = Readonly<{ dayIndex: number; minutes: number }>;

/** Current weekday (Monday = 0) and minutes since midnight in an IANA zone. */
export function getZonedClock(timezone: string, now: Date): ZonedClock | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const dayIndex = values.weekday ? WEEKDAY_INDEX[values.weekday] : undefined;
    const hour = Number(values.hour);
    const minute = Number(values.minute);
    if (
      dayIndex === undefined ||
      !Number.isInteger(hour) ||
      !Number.isInteger(minute)
    ) {
      return null;
    }
    return { dayIndex, minutes: hour * 60 + minute };
  } catch {
    return null;
  }
}

export type NextGuidance = Readonly<{
  index: number;
  name: string;
  start: string;
  end: string;
  day: Day;
  dayOffset: number;
  startsInMinutes: number;
}>;

/**
 * Next enabled guidance across the coming seven days, in the account zone.
 * Returns null while the schedule is paused so the UI cannot imply upcoming
 * activity that the owner has switched off.
 */
export function getNextGuidance(
  schedule: Schedule,
  timezone: string,
  now: Date,
): NextGuidance | null {
  if (schedule.paused) return null;
  const clock = getZonedClock(timezone, now);
  if (!clock) return null;

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const dayIndex = (clock.dayIndex + dayOffset) % 7;
    const day = DAYS[dayIndex];
    if (!day) continue;

    let best: NextGuidance | null = null;
    for (const [index, block] of schedule.guidance.entries()) {
      if (!block.enabled || !block.days.includes(day)) continue;
      const start = parseTimeToMinutes(block.start);
      const end = parseTimeToMinutes(block.end);
      if (start === null || end === null || end <= start) continue;
      if (dayOffset === 0 && start < clock.minutes) continue;
      const startsInMinutes = dayOffset * 1440 + start - clock.minutes;
      if (!best || startsInMinutes < best.startsInMinutes) {
        best = {
          index,
          name: block.name,
          start: block.start,
          end: block.end,
          day,
          dayOffset,
          startsInMinutes,
        };
      }
    }
    if (best) return best;
  }

  return null;
}

export function schedulesEqual(left: Schedule, right: Schedule): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function hasInvalidTargets(schedule: Schedule): boolean {
  return DAYS.some((day) => {
    const target = schedule.targets[day];
    return (
      !Number.isInteger(target.work) ||
      !Number.isInteger(target.jobSearch) ||
      target.work < 0 ||
      target.work > 1440 ||
      target.jobSearch < 0 ||
      target.jobSearch > 1440
    );
  });
}
