import type { DailyCheckinPatch } from "@ega/domain/checkins";

/**
 * Today's Finish day surface reuses the shutdown check-in semantics, but the
 * form lives on `/today`. Keep the payload parsing here so the server action
 * stays a thin redirect/feedback wrapper.
 */

export type TodayCheckinPayload =
  | { ok: true; patch: DailyCheckinPatch }
  | { ok: false; errorMessage: string };

/** Only Today is a valid post-action destination for this surface. */
export function getTodayCheckinReturnPath(rawReturnTo: unknown): string {
  const returnTo = String(rawReturnTo ?? "").trim();
  if (returnTo.startsWith("/today")) return returnTo;
  return "/today?finishDay=1#finish-day";
}

function parseOptionalMinutes(raw: FormDataEntryValue | null): number | null | "invalid" {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isInteger(parsed) ? parsed : "invalid";
}

function parseRoutineField(raw: FormDataEntryValue | null): number | null {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Routine metrics ride as `routine.<field>` keys. Only keys actually present
 * are patched, so unknown fields stay unknown instead of being overwritten
 * with null by a partial form.
 */
function parseRoutinePatch(formData: FormData) {
  const routine: {
    runMinutes?: number | null;
    runCompleted?: boolean | null;
    runSkipped?: boolean | null;
    chessMinutes?: number | null;
    sleepHours?: number | null;
    leisureMinutes?: number | null;
  } = {};
  const fields = ["runMinutes", "chessMinutes", "sleepHours", "leisureMinutes"] as const;
  for (const target of fields) {
    const key = `routine.${target}`;
    if (formData.has(key)) routine[target] = parseRoutineField(formData.get(key));
  }
  // Hidden inputs carry the tristate explicitly: "true"/"false", or "" for
  // unknown. Unchecked checkboxes alone would serialize nothing.
  const parseTristate = (key: string): boolean | null | undefined => {
    const raw = formData.get(key);
    if (raw === null) return undefined;
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "") return null;
    return undefined;
  };
  const runCompleted = parseTristate("routine.runCompleted");
  const runSkipped = parseTristate("routine.runSkipped");
  if (runCompleted !== undefined) routine.runCompleted = runCompleted;
  if (runSkipped !== undefined) routine.runSkipped = runSkipped;
  return routine;
}

export function buildTodayCheckinPatch(formData: FormData): TodayCheckinPayload {
  const personalMinutes = parseOptionalMinutes(formData.get("personalMinutes"));
  const overtimeMinutes = parseOptionalMinutes(formData.get("overtimeMinutes"));
  if (personalMinutes === "invalid" || overtimeMinutes === "invalid") {
    return {
      ok: false,
      errorMessage: "Use whole minutes for personal time and overtime.",
    };
  }

  return {
    ok: true,
    patch: {
      outcomes: String(formData.get("outcomes") ?? ""),
      personalMinutes: personalMinutes ?? null,
      notes: String(formData.get("notes") ?? ""),
      overtimeMinutes: overtimeMinutes ?? null,
      overtimeReason: String(formData.get("overtimeReason") ?? ""),
      routine: parseRoutinePatch(formData),
    },
  };
}
