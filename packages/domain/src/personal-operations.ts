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

export const DEFAULT_PERSONAL_OPERATIONS: PersonalOperations = {
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
};

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
