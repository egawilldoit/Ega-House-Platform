import { isIsoDate } from "./time-context";

export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Day = (typeof DAYS)[number];

/**
 * The personal schedule stays an exactly-3-key value. The stable job-search
 * reference is a separate top-level preference so it can be patched
 * independently and cannot collide with schedule saves.
 */
export type PersonalOperations = {
  paused: boolean;
  targets: Record<Day, { work: number; jobSearch: number }>;
  guidance: { name: string; days: Day[]; start: string; end: string; enabled: boolean }[];
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * The process-global default schedule. It is deep-frozen so no consumer can
 * change what every other owner reads; normalisation hands out clones.
 */
export const DEFAULT_PERSONAL_OPERATIONS: PersonalOperations = deepFreeze({
  paused: false,
  targets: {
    monday: { work: 480, jobSearch: 90 }, tuesday: { work: 480, jobSearch: 90 },
    wednesday: { work: 480, jobSearch: 90 }, thursday: { work: 480, jobSearch: 90 },
    friday: { work: 480, jobSearch: 90 }, saturday: { work: 240, jobSearch: 0 },
    sunday: { work: 240, jobSearch: 0 },
  },
  guidance: [
    { name: "Startup", days: [...DAYS], start: "06:00", end: "06:30", enabled: true },
    { name: "Job search", days: DAYS.slice(0, 5), start: "10:30", end: "12:00", enabled: true },
    { name: "Lunch", days: [...DAYS], start: "12:00", end: "13:00", enabled: true },
    { name: "Leisure", days: DAYS.slice(0, 5), start: "19:00", end: "20:30", enabled: true },
    { name: "Chess", days: [], start: "17:00", end: "17:30", enabled: false },
    { name: "Cooking", days: [], start: "18:00", end: "18:30", enabled: false },
    { name: "Run", days: [], start: "07:00", end: "07:30", enabled: false },
  ],
});

/**
 * A detached copy of a schedule. Persisted JSON and the global defaults are
 * both cloned so an edited draft never mutates its source.
 */
export function clonePersonalOperations(schedule: PersonalOperations): PersonalOperations {
  return {
    paused: schedule.paused,
    targets: Object.fromEntries(
      DAYS.map((day) => [day, { work: schedule.targets[day].work, jobSearch: schedule.targets[day].jobSearch }]),
    ) as PersonalOperations["targets"],
    guidance: schedule.guidance.map((block) => ({
      name: block.name,
      days: [...block.days],
      start: block.start,
      end: block.end,
      enabled: block.enabled,
    })),
  };
}

export type PersonalOperationsDayPlan = Readonly<{
  date: string;
  day: Day;
  paused: boolean;
  target: Readonly<{ work: number; jobSearch: number }>;
  guidance: ReadonlyArray<Readonly<{ name: string; start: string; end: string }>>;
}>;

export type PersonalOperationsDayPlanResult =
  | Readonly<{ ok: true; value: PersonalOperationsDayPlan }>
  | Readonly<{ ok: false; message: string }>;

function dayOfIsoDate(dateStr: string): Day {
  const [year, month, day] = dateStr.split("-").map(Number);
  // The calendar date is already the owner's local date, so weekday lookup
  // stays on the calendar axis and never performs timezone math. Build from a
  // fixed base and set the full year afterwards: Date.UTC maps years 0-99 to
  // 1900+year, which would resolve the wrong weekday for "0099-01-01".
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day);
  const weekday = date.getUTCDay();
  return DAYS[(weekday + 6) % 7];
}

/**
 * Resolve one local calendar day against the schedule.
 *
 * `localDate` must be an ISO calendar date already resolved in the account
 * Time Context; this module intentionally stores no timezone of its own.
 * Invalid dates return an actionable failure instead of throwing.
 */
export function getPersonalOperationsDayPlan(
  schedule: PersonalOperations,
  localDate: string,
): PersonalOperationsDayPlanResult {
  if (!isIsoDate(localDate)) {
    return {
      ok: false,
      message: `Invalid local date: expected YYYY-MM-DD, got "${String(localDate)}".`,
    };
  }

  const day = dayOfIsoDate(localDate);
  const target = schedule.targets[day];
  const guidance = schedule.guidance
    .filter((block) => block.enabled && block.days.includes(day))
    .sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0))
    .map((block) => ({ name: block.name, start: block.start, end: block.end }));

  return {
    ok: true,
    value: {
      date: localDate,
      day,
      paused: schedule.paused,
      target: { work: target.work, jobSearch: target.jobSearch },
      guidance,
    },
  };
}

/** Weekly target totals across every weekday. */
export function getPersonalOperationsWeekTotals(
  schedule: PersonalOperations,
): { work: number; jobSearch: number } {
  return DAYS.reduce(
    (totals, day) => ({
      work: totals.work + schedule.targets[day].work,
      jobSearch: totals.jobSearch + schedule.targets[day].jobSearch,
    }),
    { work: 0, jobSearch: 0 },
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function time(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Validates a complete 3-key schedule; enabled guidance may not overlap on a day. */
export function isPersonalOperations(value: unknown): value is PersonalOperations {
  if (!record(value) || Object.keys(value).length !== 3 || Object.keys(value).some(k => !["paused", "targets", "guidance"].includes(k)) || typeof value.paused !== "boolean" || !record(value.targets) || !Array.isArray(value.guidance) || value.guidance.length > 20) return false;
  const targets = value.targets;
  if (Object.keys(targets).length !== DAYS.length || !DAYS.every(day => {
    const target = targets[day];
    return record(target) && Object.keys(target).length === 2 && [target.work, target.jobSearch].every(n => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1440);
  })) return false;
  const occupied: Record<string, {start: string; end: string}[]> = {};
  for (const block of value.guidance) {
    if (!record(block) || Object.keys(block).length !== 5 || typeof block.name !== "string" || !block.name.trim() || block.name.length > 80 || typeof block.enabled !== "boolean" || !time(block.start) || !time(block.end) || block.start >= block.end || !Array.isArray(block.days) || !block.days.every((d: unknown) => typeof d === "string" && DAYS.includes(d as Day)) || new Set(block.days).size !== block.days.length) return false;
    if (block.enabled) for (const day of block.days as Day[]) {
      const prior = occupied[day] ?? [];
      if (prior.some(other => block.start as string < other.end && block.end as string > other.start)) return false;
      prior.push({ start: block.start, end: block.end }); occupied[day] = prior;
    }
  }
  return true;
}
