"use server";

import {
  queueTaskForTomorrow,
  saveShutdownReflectionNote,
} from "@/lib/services/shutdown-service";
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

  const result = await queueTaskForTomorrow(taskId);

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("shutdown", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    successMessage: "Task queued for tomorrow.",
  });
}

export async function saveShutdownReflectionNoteAction(formData: FormData) {
  const returnPath = await getShutdownReturnPath(formData.get("returnTo"));
  const note = String(formData.get("reflectionNote") ?? "");
  const result = await saveShutdownReflectionNote(note);

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("shutdown", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    successMessage: "Reflection note saved to this week.",
  });
}
