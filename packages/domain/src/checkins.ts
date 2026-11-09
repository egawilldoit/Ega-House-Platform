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

export type DailyCheckin = Readonly<{
  localDate: string;
  timezone: string;
  outcomes: string | null;
  personalMinutes: number | null;
  notes: string | null;
  overtimeMinutes: number | null;
  overtimeReason: string | null;
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
}>;

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
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}
