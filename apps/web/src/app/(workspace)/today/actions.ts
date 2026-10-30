"use server";

import {
  addTaskToToday,
  clearCompletedFromToday,
  removeTaskFromToday,
  updateTodayTaskStatus,
} from "@/lib/services/today-planner-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

function getTodayReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();

  if (returnTo.startsWith("/today") || returnTo.startsWith("/home")) {
    return returnTo;
  }

  return "/today";
}

/**
 * Canonical account local date for Today writes. Degrades to null when Time
 * Context is unavailable so the service can fall back to its legacy behavior.
 */
async function resolveAccountLocalDate(): Promise<string | null> {
  return (await getWebTimeContext().catch(() => null))?.localDate ?? null;
}

export async function addTaskToTodayAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const localDate = await resolveAccountLocalDate();

  const result = await addTaskToToday(taskId, { localDate: localDate ?? undefined });

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("today", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath);
}

export async function removeTaskFromTodayAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const result = await removeTaskFromToday(taskId);

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("today", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath);
}

export async function updateTodayTaskStatusAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  const result = await updateTodayTaskStatus(taskId, status);

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("today", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath);
}

export async function completeTodayTaskAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const result = await updateTodayTaskStatus(taskId, "done");

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("today", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath);
}

export async function markTodayTaskBlockedAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const blockedReason = String(formData.get("blockedReason") ?? "").trim();

  const result = await updateTodayTaskStatus(taskId, "blocked", {
    blockedReason,
  });

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("today", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath);
}

export async function clearCompletedFromTodayAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const localDate = await resolveAccountLocalDate();

  const result = await clearCompletedFromToday({ localDate: localDate ?? undefined });

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("today", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath);
}
