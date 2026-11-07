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

type ZonedParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayIndex: number;
}>;

function getZonedParts(timezone: string, date: Date): ZonedParts | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const dayIndex = values.weekday ? WEEKDAY_INDEX[values.weekday] : undefined;
    const year = Number(values.year);
    const month = Number(values.month);
    const day = Number(values.day);
    const hour = Number(values.hour);
    const minute = Number(values.minute);
    const second = Number(values.second);
    if (
      dayIndex === undefined ||
      ![year, month, day, hour, minute, second].every(Number.isInteger)
    ) {
      return null;
    }
    return { year, month, day, hour, minute, second, dayIndex };
  } catch {
    return null;
  }
}

/** True only when `Intl` can resolve the zone (so a bad stored zone is visible). */
export function isValidTimeZone(timezone: string): boolean {
  return getZonedParts(timezone, new Date()) !== null;
}

/** Current weekday (Monday = 0) and minutes since midnight in an IANA zone. */
export function getZonedClock(timezone: string, now: Date): ZonedClock | null {
  const parts = getZonedParts(timezone, now);
  if (!parts) return null;
  return { dayIndex: parts.dayIndex, minutes: parts.hour * 60 + parts.minute };
}

function zoneOffsetMs(timezone: string, date: Date): number | null {
  const parts = getZonedParts(timezone, date);
  if (!parts) return null;
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function matchesWallTime(
  timezone: string,
  instant: Date,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): boolean {
  const parts = getZonedParts(timezone, instant);
  return Boolean(
    parts &&
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute,
  );
}

/**
 * Resolves a wall-clock date/time in a zone to an absolute instant.
 *
 * DST policy for this display-only helper:
 * - 0 round-trip matches means the wall time does not exist (spring gap); skip
 *   the occurrence rather than inventing an earlier/later local time.
 * - 2 matches means the wall time repeats (fall back); choose the earlier
 *   occurrence only, so the same block never appears twice.
 * - Ordinary dates resolve to one instant.
 *
 * Offsets are probed around the target so the ±12h and ±36h brackets cover
 * normal DST transitions and date-line shifts without assuming 24h days.
 */
export function resolveZonedWallTime(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const candidates = new Set<number>();
  const probes = [
    guess - 36 * 60 * 60_000,
    guess - 12 * 60 * 60_000,
    guess,
    guess + 12 * 60 * 60_000,
    guess + 36 * 60 * 60_000,
  ];

  for (const probe of probes) {
    const offset = zoneOffsetMs(timezone, new Date(probe));
    if (offset !== null) candidates.add(guess - offset);
  }

  const matches = [...candidates]
    .map((instant) => new Date(instant))
    .filter((instant) =>
      matchesWallTime(timezone, instant, year, month, day, hour, minute),
    )
    .sort((left, right) => left.getTime() - right.getTime());

  return matches[0] ?? null;
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  offset: number,
): Readonly<{ year: number; month: number; day: number }> {
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
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
  const anchor = getZonedParts(timezone, now);
  if (!clock || !anchor) return null;

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const dayIndex = (clock.dayIndex + dayOffset) % 7;
    const day = DAYS[dayIndex];
    if (!day) continue;
    const targetDate = addCalendarDays(anchor.year, anchor.month, anchor.day, dayOffset);

    let best: NextGuidance | null = null;
    for (const [index, block] of schedule.guidance.entries()) {
      if (!block.enabled || !block.days.includes(day)) continue;
      const start = parseTimeToMinutes(block.start);
      const end = parseTimeToMinutes(block.end);
      if (start === null || end === null || end <= start) continue;
      const instant = resolveZonedWallTime(
        timezone,
        targetDate.year,
        targetDate.month,
        targetDate.day,
        Math.floor(start / 60),
        start % 60,
      );
      if (!instant || instant.getTime() < now.getTime()) continue;
      const startsInMinutes = Math.round((instant.getTime() - now.getTime()) / 60_000);
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
