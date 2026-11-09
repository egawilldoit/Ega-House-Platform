"use server";

import { saveWebDailyCheckin } from "@/lib/services/checkin-service";
import {
  queueTaskForTomorrow,
  saveShutdownReflectionNote,
} from "@/lib/services/shutdown-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { formatTaskDueDate, getTodayLocalIsoDate } from "@/lib/task-due-date";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

export async function getShutdownReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();

  if (returnTo.startsWith("/shutdown")) {
    return returnTo;
  }

  return "/shutdown";
}

export async function carryForwardTaskToTomorrowAction(formData: FormData) {
  const returnPath = await getShutdownReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const intent = formData.get("intent") === "carry" ? "carry" : "add";
  const localDate = (await getWebTimeContext().catch(() => null))?.localDate ?? null;

  const result = await queueTaskForTomorrow(taskId, {
    localDate: localDate ?? undefined,
    intent,
  });

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("shutdown", { returnTo: returnPath });

  const successMessage = intent === "add"
    ? "Task queued for tomorrow."
    : `Carried "${result.title ?? "Task"}" to ${formatTaskDueDate(
        result.tomorrowDate ?? localDate ?? getTodayLocalIsoDate(),
      )}`;

  redirectWithWorkspaceFeedback(returnPath, { successMessage });
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
 * Routine metrics (PO-10, issue #351) ride as `routine.<field>` form keys.
 * Only keys actually present are patched, so unknown fields stay unknown
 * instead of being silently overwritten with null by a partial form.
 */
function parseRoutinePatch(formData: FormData) {
  const routine: {
    runMinutes?: number | null;
    runCompleted?: boolean;
    runSkipped?: boolean;
    chessMinutes?: number | null;
    sleepHours?: number | null;
    leisureMinutes?: number | null;
  } = {};
  const fields = ["runMinutes", "chessMinutes", "sleepHours", "leisureMinutes"] as const;
  for (const target of fields) {
    const key = `routine.${target}`;
    if (formData.has(key)) routine[target] = parseRoutineField(formData.get(key));
  }
  const runCompleted = formData.get("routine.runCompleted");
  const runSkipped = formData.get("routine.runSkipped");
  if (runCompleted === "on") routine.runCompleted = true;
  if (runSkipped === "on") routine.runSkipped = true;
  return routine;
}

export async function saveDailyCheckinAction(formData: FormData) {
  const returnPath = await getShutdownReturnPath(formData.get("returnTo"));
  const timeContext = await getWebTimeContext().catch(() => null);
  const timezone = timeContext?.timezone ?? "";
  const localDateInput = String(formData.get("localDate") ?? "").trim();
  const localDate = localDateInput || timeContext?.localDate || "";

  const personalMinutes = parseOptionalMinutes(formData.get("personalMinutes"));
  const overtimeMinutes = parseOptionalMinutes(formData.get("overtimeMinutes"));
  if (personalMinutes === "invalid" || overtimeMinutes === "invalid") {
    redirectWithWorkspaceFeedback(returnPath, {
      errorMessage: "Use whole minutes for personal time and overtime.",
    });
  }

  const patch: {
    outcomes: string | null;
    personalMinutes: number | null;
    notes: string | null;
    overtimeMinutes: number | null;
    overtimeReason: string | null;
    routine: Record<string, number | null | boolean>;
  } = {
    outcomes: String(formData.get("outcomes") ?? ""),
    personalMinutes: personalMinutes ?? null,
    notes: String(formData.get("notes") ?? ""),
    overtimeMinutes: overtimeMinutes ?? null,
    overtimeReason: String(formData.get("overtimeReason") ?? ""),
    routine: parseRoutinePatch(formData),
  };

  const result = await saveWebDailyCheckin({ localDate, timezone, patch });
  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("shutdown", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    successMessage: result.overtimeAdvisory
      ? `Check-in saved. ${result.overtimeAdvisory}`
      : "Check-in saved for your day.",
  });
}

export async function saveShutdownReflectionNoteAction(formData: FormData) {
  const returnPath = await getShutdownReturnPath(formData.get("returnTo"));
  const note = String(formData.get("reflectionNote") ?? "");
  const localDate = (await getWebTimeContext().catch(() => null))?.localDate ?? null;
  const result = await saveShutdownReflectionNote(note, { localDate: localDate ?? undefined });

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("shutdown", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    successMessage: "Reflection note saved to this week.",
  });
}
