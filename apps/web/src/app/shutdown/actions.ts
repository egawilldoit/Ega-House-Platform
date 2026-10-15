"use server";

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
  const intent = String(formData.get("intent") ?? "")
    .trim()
    .toLowerCase();
  const localDate = (await getWebTimeContext().catch(() => null))?.localDate ?? null;

  const result = await queueTaskForTomorrow(taskId, {
    localDate: localDate ?? undefined,
    intent,
  });

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("shutdown", { returnTo: returnPath });

  const isAddIntent = intent.startsWith("add");
  const successMessage = isAddIntent
    ? "Task queued for tomorrow."
    : `Carried "${result.title ?? "Task"}" to ${formatTaskDueDate(
        result.tomorrowDate ?? localDate ?? getTodayLocalIsoDate(),
      )}`;

  redirectWithWorkspaceFeedback(returnPath, { successMessage });
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
