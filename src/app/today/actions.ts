"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  addTaskToToday,
  clearCompletedFromToday,
  removeTaskFromToday,
  updateTodayTaskStatus,
} from "@/lib/services/today-planner-service";

function getTodayReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();

  if (returnTo.startsWith("/today")) {
    return returnTo;
  }

  return "/today";
}

function revalidateTodaySurfaces(returnPath: string) {
  revalidatePath("/today");
  revalidatePath(returnPath);
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/timer");
  revalidatePath("/review");
}

function redirectWithActionError(returnPath: string, errorMessage: string): never {
  const target = new URL(returnPath, "https://egawilldoit.online");
  target.searchParams.set("actionError", errorMessage);
  redirect(`${target.pathname}${target.search}`);
}

export async function addTaskToTodayAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const result = await addTaskToToday(taskId);

  if (result.errorMessage) {
    redirectWithActionError(returnPath, result.errorMessage);
  }

  revalidateTodaySurfaces(returnPath);
  redirect(returnPath);
}

export async function removeTaskFromTodayAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const result = await removeTaskFromToday(taskId);

  if (result.errorMessage) {
    redirectWithActionError(returnPath, result.errorMessage);
  }

  revalidateTodaySurfaces(returnPath);
  redirect(returnPath);
}

export async function updateTodayTaskStatusAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  const result = await updateTodayTaskStatus(taskId, status);

  if (result.errorMessage) {
    redirectWithActionError(returnPath, result.errorMessage);
  }

  revalidateTodaySurfaces(returnPath);
  redirect(returnPath);
}

export async function completeTodayTaskAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const result = await updateTodayTaskStatus(taskId, "done");

  if (result.errorMessage) {
    redirectWithActionError(returnPath, result.errorMessage);
  }

  revalidateTodaySurfaces(returnPath);
  redirect(returnPath);
}

export async function markTodayTaskBlockedAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const blockedReason = String(formData.get("blockedReason") ?? "").trim();

  const result = await updateTodayTaskStatus(taskId, "blocked", {
    blockedReason,
  });

  if (result.errorMessage) {
    redirectWithActionError(returnPath, result.errorMessage);
  }

  revalidateTodaySurfaces(returnPath);
  redirect(returnPath);
}

export async function clearCompletedFromTodayAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const result = await clearCompletedFromToday();

  if (result.errorMessage) {
    redirectWithActionError(returnPath, result.errorMessage);
  }

  revalidateTodaySurfaces(returnPath);
  redirect(returnPath);
}
