export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Day = (typeof DAYS)[number];

export const JOB_SEARCH_REFERENCE_KINDS = ["task", "project"] as const;
export type JobSearchReferenceKind = (typeof JOB_SEARCH_REFERENCE_KINDS)[number];

/**
 * Stable owner-work reference used to classify tracked time as job search.
 *
 * Classification is an exact id match only. Titles are deliberately not part
 * of the identity: renaming, archiving, or moving a task/project must not
 * change historical job-search totals.
 */
export type JobSearchReference = {
  kind: JobSearchReferenceKind;
  id: string;
};

export type PersonalOperations = {
  paused: boolean;
  targets: Record<Day, { work: number; jobSearch: number }>;
  guidance: { name: string; days: Day[]; start: string; end: string; enabled: boolean }[];
  /** Optional stable reference for job-search classification. Legacy rows omit it. */
  jobSearchReference?: JobSearchReference | null;
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
  jobSearchReference: null,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function time(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the stable job-search reference shape (kind + UUID id). */
export function isJobSearchReference(value: unknown): value is JobSearchReference {
  return (
    record(value) &&
    Object.keys(value).length === 2 &&
    typeof value.kind === "string" &&
    (JOB_SEARCH_REFERENCE_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.id === "string" &&
    UUID_RE.test(value.id)
  );
}

/**
 * Validates a complete schedule; enabled guidance may not overlap on a day.
 *
 * Both the legacy 3-key row (no `jobSearchReference`) and the current 4-key row
 * are accepted so existing persisted schedules keep their targets/guidance
 * instead of falling back to defaults.
 */
export function isPersonalOperations(value: unknown): value is PersonalOperations {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  if (keys.some(k => !["paused", "targets", "guidance", "jobSearchReference"].includes(k))) return false;
  if (keys.length !== 3 && keys.length !== 4) return false;
  if (typeof value.paused !== "boolean" || !record(value.targets) || !Array.isArray(value.guidance) || value.guidance.length > 20) return false;
  if ("jobSearchReference" in value && value.jobSearchReference !== null && !isJobSearchReference(value.jobSearchReference)) return false;
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

/**
 * Returns a complete 4-key schedule. Legacy 3-key rows keep their own
 * targets and guidance; only the new reference is filled with `null`.
 * Invalid input falls back to the documented defaults, matching
 * `normalizeUserPreferences` field behaviour.
 */
export function normalizePersonalOperations(value: unknown): PersonalOperations {
  if (!isPersonalOperations(value)) return DEFAULT_PERSONAL_OPERATIONS;
  return {
    paused: value.paused,
    targets: value.targets,
    guidance: value.guidance,
    jobSearchReference: value.jobSearchReference ?? null,
  };
}
