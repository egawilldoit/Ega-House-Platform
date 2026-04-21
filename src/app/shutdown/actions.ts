"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  queueTaskForTomorrow,
  saveShutdownReflectionNote,
} from "@/lib/services/shutdown-service";

export async function getShutdownReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();

  if (returnTo.startsWith("/shutdown")) {
    return returnTo;
  }

  return "/shutdown";
}

function revalidateShutdownSurfaces(returnPath: string) {
  revalidatePath("/shutdown");
  revalidatePath(returnPath);
  revalidatePath("/today");
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/timer");
  revalidatePath("/review");
}

function redirectWithShutdownError(returnPath: string, errorMessage: string): never {
  const target = new URL(returnPath, "https://egawilldoit.online");
  target.searchParams.set("actionError", errorMessage);
  redirect(`${target.pathname}${target.search}`);
}

function redirectWithShutdownSuccess(returnPath: string, successMessage: string): never {
  const target = new URL(returnPath, "https://egawilldoit.online");
  target.searchParams.set("actionSuccess", successMessage);
  redirect(`${target.pathname}${target.search}`);
}

export async function carryForwardTaskToTomorrowAction(formData: FormData) {
  const returnPath = await getShutdownReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const result = await queueTaskForTomorrow(taskId);

  if (result.errorMessage) {
    redirectWithShutdownError(returnPath, result.errorMessage);
  }

  revalidateShutdownSurfaces(returnPath);
  redirectWithShutdownSuccess(returnPath, "Task queued for tomorrow.");
}

export async function saveShutdownReflectionNoteAction(formData: FormData) {
  const returnPath = await getShutdownReturnPath(formData.get("returnTo"));
  const note = String(formData.get("reflectionNote") ?? "");
  const result = await saveShutdownReflectionNote(note);

  if (result.errorMessage) {
    redirectWithShutdownError(returnPath, result.errorMessage);
  }

  revalidateShutdownSurfaces(returnPath);
  redirectWithShutdownSuccess(returnPath, "Reflection note saved to this week.");
}
