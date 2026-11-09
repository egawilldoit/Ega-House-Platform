import {
  isIsoDate,
  isValidIANATimeZone,
} from "./time-context";

/**
 * Canonical daily check-in (PO-05, issue #345).
 *
 * One qualitative outcome record per owner/local date. Timer hours and task
 * completion are derived at read time from their canonical sources and are
 * never copied into this record. At most one row exists per
 * (owner, local_date); partial saves preserve fields the caller omitted.
 */

/**
 * Optional bounded routine metrics (PO-10, issue #351). Every field is
 * nullable: null = unknown/unrecorded (never a failed habit or zero),
 * an explicit value — including 0 — is a recorded fact. Run minutes never
 * create timer sessions and leisure/chores never count as work time.
 */
export type RoutineMetrics = Readonly<{
  runMinutes: number | null;
  runCompleted: boolean | null;
  runSkipped: boolean | null;
  chessMinutes: number | null;
  sleepHours: number | null;
  leisureMinutes: number | null;
}>;

export type DailyCheckin = Readonly<{
  localDate: string;
  timezone: string;
  outcomes: string | null;
  personalMinutes: number | null;
  notes: string | null;
  overtimeMinutes: number | null;
  overtimeReason: string | null;
  routine: RoutineMetrics | null;
  createdAt: string;
  updatedAt: string;
}>;

/** Fields a client may set. Absent = preserve; null = clear. */
export type DailyCheckinPatch = Readonly<{
  outcomes?: string | null;
  personalMinutes?: number | null;
  notes?: string | null;
  overtimeMinutes?: number | null;
  overtimeReason?: string | null;
  routine?: Partial<RoutineMetrics> | null;
}>;

export const EMPTY_ROUTINE_METRICS: RoutineMetrics = Object.freeze({
  runMinutes: null,
  runCompleted: null,
  runSkipped: null,
  chessMinutes: null,
  sleepHours: null,
  leisureMinutes: null,
});

/** Nominal run sessions per week for the 14-day experiment. */
export const ROUTINE_WEEKLY_RUN_TARGET = 3;

const ROUTINE_KEYS = [
  "runMinutes",
  "runCompleted",
  "runSkipped",
  "chessMinutes",
  "sleepHours",
  "leisureMinutes",
] as const;

/** Parses a candidate routine object; unknown keys and bad types rejected. */
export function parseRoutineMetrics(
  raw: unknown,
):
  | Readonly<{ ok: true; value: Partial<RoutineMetrics> }>
  | Readonly<{ ok: false; field: string; message: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, field: "routine", message: "Routine values are not readable." };
  }
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!(ROUTINE_KEYS as readonly string[]).includes(key)) {
      return { ok: false, field: "routine", message: "Routine has an unknown field." };
    }
  }
  const parsed: { [K in (typeof ROUTINE_KEYS)[number]]?: RoutineMetrics[K] } = {};
  for (const key of ROUTINE_KEYS) {
    if (!(key in value) || value[key] === undefined) continue;
    const fieldValue = value[key];
    if (fieldValue === null) {
      parsed[key] = null;
      continue;
    }
    if (key === "runCompleted" || key === "runSkipped") {
      if (typeof fieldValue !== "boolean") {
        return { ok: false, field: `routine.${key}`, message: "Use true or false." };
      }
      parsed[key] = fieldValue;
      continue;
    }
    if (typeof fieldValue !== "number" || fieldValue < 0) {
      return { ok: false, field: `routine.${key}`, message: "Use values of zero or more." };
    }
    if (key === "sleepHours") {
      // Sleep may use half hours; anything finer is not recorded.
      if (fieldValue > 24 || !Number.isInteger(fieldValue * 2)) {
        return { ok: false, field: "routine.sleepHours", message: "Sleep is 0 to 24 hours in half-hour steps." };
      }
    } else {
      if (!Number.isInteger(fieldValue)) {
        return { ok: false, field: `routine.${key}`, message: "Use whole minutes." };
      }
      if (fieldValue > DAILY_CHECKIN_MINUTES_MAX) {
        return { ok: false, field: `routine.${key}`, message: `Use at most ${DAILY_CHECKIN_MINUTES_MAX} minutes.` };
      }
    }
    parsed[key] = fieldValue;
  }
  return { ok: true, value: parsed };
}

/** Field-wise merge of a routine patch onto the stored routine. */
export function mergeRoutineMetrics(
  existing: RoutineMetrics | null,
  patch: Partial<RoutineMetrics> | null,
): RoutineMetrics | null {
  if (patch === null) return null;
  if (Object.keys(patch).length === 0) return existing;
  return { ...EMPTY_ROUTINE_METRICS, ...(existing ?? {}), ...patch };
}

/**
 * Weekly run derivation from daily records: counts explicit completions
 * (never minutes, never timer sessions). Skips and unknowns are excluded
 * from both the count and any inferred failure state.
 */
export function countWeeklyRunSessions(
  records: Array<{ localDate: string; routine: RoutineMetrics | null }>,
  weekStartLocalDate: string,
  weekEndLocalDate: string,
): Readonly<{ completedSessions: number; totalRunMinutes: number }> {
  let completedSessions = 0;
  let totalRunMinutes = 0;
  for (const record of records) {
    if (record.localDate < weekStartLocalDate || record.localDate > weekEndLocalDate) continue;
    if (record.routine?.runCompleted !== true) continue;
    completedSessions += 1;
    const minutes = record.routine.runMinutes;
    if (minutes !== null && minutes !== undefined) totalRunMinutes += minutes;
  }
  return { completedSessions, totalRunMinutes };
}

export const DAILY_CHECKIN_MINUTES_MIN = 0;
export const DAILY_CHECKIN_MINUTES_MAX = 1440;
export const DAILY_CHECKIN_OUTCOMES_MAX_LENGTH = 500;
export const DAILY_CHECKIN_NOTES_MAX_LENGTH = 1000;
export const DAILY_CHECKIN_OVERTIME_REASON_MAX_LENGTH = 300;

export type DailyCheckinParseResult =
  | Readonly<{ ok: true; value: DailyCheckinPatch }>
  | Readonly<{ ok: false; field: string; message: string }>;

function parseOptionalText(
  raw: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; field: string; message: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, field, message: "Use text for this field." };
  }
  const trimmed = raw.trim();
  if (trimmed.length > maxLength) {
    return { ok: false, field, message: `Keep this under ${maxLength} characters.` };
  }
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

function parseOptionalMinutes(
  raw: unknown,
  field: string,
): { ok: true; value: number | null } | { ok: false; field: string; message: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return { ok: false, field, message: "Use whole minutes." };
  }
  if (raw < DAILY_CHECKIN_MINUTES_MIN || raw > DAILY_CHECKIN_MINUTES_MAX) {
    return {
      ok: false,
      field,
      message: `Use between ${DAILY_CHECKIN_MINUTES_MIN} and ${DAILY_CHECKIN_MINUTES_MAX} minutes.`,
    };
  }
  return { ok: true, value: raw };
}

/**
 * Parses a candidate daily check-in patch. Only recognised keys are read;
 * absent keys are left untouched by the caller (patch semantics). The
 * overtime cross-field rule is enforced against the merged record by
 * `validateDailyCheckinRecord`, not here, so partial saves stay possible.
 */
export function parseDailyCheckinPatch(input: unknown): DailyCheckinParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, field: "checkin", message: "Check-in values are not readable." };
  }
  const value = input as Record<string, unknown>;
  const patch: {
    outcomes?: string | null;
    personalMinutes?: number | null;
    notes?: string | null;
    overtimeMinutes?: number | null;
    overtimeReason?: string | null;
    routine?: Partial<RoutineMetrics> | null;
  } = {};

  if ("outcomes" in value && value.outcomes !== undefined) {
    const parsed = parseOptionalText(value.outcomes, "outcomes", DAILY_CHECKIN_OUTCOMES_MAX_LENGTH);
    if (!parsed.ok) return parsed;
    patch.outcomes = parsed.value;
  }
  if ("personalMinutes" in value && value.personalMinutes !== undefined) {
    const parsed = parseOptionalMinutes(value.personalMinutes, "personalMinutes");
    if (!parsed.ok) return parsed;
    patch.personalMinutes = parsed.value;
  }
  if ("notes" in value && value.notes !== undefined) {
    const parsed = parseOptionalText(value.notes, "notes", DAILY_CHECKIN_NOTES_MAX_LENGTH);
    if (!parsed.ok) return parsed;
    patch.notes = parsed.value;
  }
  if ("overtimeMinutes" in value && value.overtimeMinutes !== undefined) {
    const parsed = parseOptionalMinutes(value.overtimeMinutes, "overtimeMinutes");
    if (!parsed.ok) return parsed;
    patch.overtimeMinutes = parsed.value;
  }
  if ("overtimeReason" in value && value.overtimeReason !== undefined) {
    const parsed = parseOptionalText(value.overtimeReason, "overtimeReason", DAILY_CHECKIN_OVERTIME_REASON_MAX_LENGTH);
    if (!parsed.ok) return parsed;
    patch.overtimeReason = parsed.value;
  }
  if ("routine" in value && value.routine !== undefined) {
    if (value.routine === null) {
      patch.routine = null;
    } else {
      const parsed = parseRoutineMetrics(value.routine);
      if (!parsed.ok) return parsed;
      patch.routine = parsed.value;
    }
  }

  return { ok: true, value: patch };
}

/** Validates an owner/date identity plus timezone snapshot. */
export function parseDailyCheckinIdentity(input: unknown):
  | Readonly<{ ok: true; localDate: string; timezone: string }>
  | Readonly<{ ok: false; field: string; message: string }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, field: "checkin", message: "Check-in date is not readable." };
  }
  const value = input as Record<string, unknown>;
  if (typeof value.localDate !== "string" || !isIsoDate(value.localDate)) {
    return { ok: false, field: "localDate", message: "Use a valid calendar date." };
  }
  if (typeof value.timezone !== "string" || !isValidIANATimeZone(value.timezone)) {
    return { ok: false, field: "timezone", message: "Use a valid time zone." };
  }
  return { ok: true, localDate: value.localDate, timezone: value.timezone };
}

export type DailyCheckinRecordValidation =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; field: string; message: string }>;

/** Cross-field rule on the merged record: overtime minutes require a reason. */
export function validateDailyCheckinRecord(record: {
  overtimeMinutes: number | null;
  overtimeReason: string | null;
}): DailyCheckinRecordValidation {
  if (
    record.overtimeMinutes !== null
    && record.overtimeMinutes > 0
    && (record.overtimeReason === null || record.overtimeReason.trim() === "")
  ) {
    return {
      ok: false,
      field: "overtimeReason",
      message: "Overtime needs a short reason.",
    };
  }
  return { ok: true };
}

/** Merges a patch onto an existing record; omitted fields are preserved. */
export function mergeDailyCheckinPatch(
  existing: DailyCheckin | null,
  patch: DailyCheckinPatch,
  identity: { localDate: string; timezone: string },
  nowIso: string,
): DailyCheckin {
  return {
    localDate: identity.localDate,
    timezone: identity.timezone,
    outcomes: patch.outcomes === undefined ? (existing?.outcomes ?? null) : patch.outcomes,
    personalMinutes:
      patch.personalMinutes === undefined ? (existing?.personalMinutes ?? null) : patch.personalMinutes,
    notes: patch.notes === undefined ? (existing?.notes ?? null) : patch.notes,
    overtimeMinutes:
      patch.overtimeMinutes === undefined ? (existing?.overtimeMinutes ?? null) : patch.overtimeMinutes,
    overtimeReason:
      patch.overtimeReason === undefined ? (existing?.overtimeReason ?? null) : patch.overtimeReason,
    routine:
      patch.routine === undefined
        ? (existing?.routine ?? null)
        : mergeRoutineMetrics(existing?.routine ?? null, patch.routine),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}
