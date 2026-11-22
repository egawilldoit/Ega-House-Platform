"use server";

import { saveWebDailyCheckin } from "@/lib/services/checkin-service";
import { saveShutdownReflectionNote } from "@/lib/services/shutdown-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import {
  buildTodayCheckinPatch,
  getTodayCheckinReturnPath,
} from "@/lib/today-checkin";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

/**
 * Close-day writes from Today. The day boundary and timezone come from the
 * same canonical Time Context as /shutdown, so a check-in saved here lands on
 * the same local day it would there.
 */
export async function saveTodayCheckinAction(formData: FormData) {
  const returnPath = getTodayCheckinReturnPath(formData.get("returnTo"));
  const timeContext = await getWebTimeContext().catch(() => null);
  const timezone = timeContext?.timezone ?? "";
  const localDateInput = String(formData.get("localDate") ?? "").trim();
  const localDate = localDateInput || timeContext?.localDate || "";

  const payload = buildTodayCheckinPatch(formData);
  if (!payload.ok) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: payload.errorMessage });
  }

  const result = await saveWebDailyCheckin({
    localDate,
    timezone,
    patch: payload.patch,
  });
  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  // The check-in belongs to Shutdown too; refresh both projections.
  revalidateWorkspaceFor("shutdown", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    successMessage: result.overtimeAdvisory
      ? `Check-in saved. ${result.overtimeAdvisory}`
      : "Check-in saved for your day.",
  });
}

export async function saveTodayReflectionNoteAction(formData: FormData) {
  const returnPath = getTodayCheckinReturnPath(formData.get("returnTo"));
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
