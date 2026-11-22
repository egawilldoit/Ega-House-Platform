import {
  DAYS,
  type Day,
} from "@ega/domain/preferences";

export const WORK_TARGET_MINUTES_MAX = 1_440;

export type WorkTargets = Readonly<
  Record<Day, Readonly<{ work: number; jobSearch: number }>>
>;

export type WorkTargetsParseResult =
  | Readonly<{ ok: true; targets: WorkTargets; paused: boolean }>
  | Readonly<{ ok: false; message: string }>;

/** Presents persisted whole minutes as a compact decimal-hour input value. */
export function minutesToHoursValue(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Parses an hours input into persisted whole minutes.
 *
 * The persisted schedule stays integer minutes, so the boundary rounds once and
 * rejects anything outside a calendar day instead of silently clamping.
 */
export function parseHoursToMinutes(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) return null;
  const minutes = Math.round(hours * 60);
  return minutes >= 0 && minutes <= WORK_TARGET_MINUTES_MAX ? minutes : null;
}

export function getWeeklyTargetTotals(targets: WorkTargets): {
  work: number;
  jobSearch: number;
} {
  return DAYS.reduce(
    (totals, day) => ({
      work: totals.work + targets[day].work,
      jobSearch: totals.jobSearch + targets[day].jobSearch,
    }),
    { work: 0, jobSearch: 0 },
  );
}

/**
 * Builds the validated target values from the lean form.
 *
 * Guidance blocks are intentionally not part of this form. The server action
 * carries the stored guidance and job-search reference through unchanged so
 * retiring the weekly block editor does not erase persisted plan data.
 */
export function parseWorkTargetsForm(
  formData: FormData,
): WorkTargetsParseResult {
  const targets = {} as Record<Day, { work: number; jobSearch: number }>;

  for (const day of DAYS) {
    const work = parseHoursToMinutes(formData.get(`work-${day}`));
    if (work === null) {
      return {
        ok: false,
        message: `Enter ${day} work target as hours between 0 and 24.`,
      };
    }
    const jobSearch = parseHoursToMinutes(formData.get(`jobSearch-${day}`));
    if (jobSearch === null) {
      return {
        ok: false,
        message: `Enter ${day} job-search target as hours between 0 and 24.`,
      };
    }
    targets[day] = { work, jobSearch };
  }

  return {
    ok: true,
    targets,
    paused: formData.get("paused") === "on",
  };
}
