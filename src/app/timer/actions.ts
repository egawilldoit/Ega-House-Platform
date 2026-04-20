"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getTimerActionReturnPath } from "@/app/timer/return-path";
import {
  resolveOpenTimerSessionConflict,
  startTimerForTask,
  stopTimerSession,
} from "@/lib/services/timer-service";

function redirectToTimer(returnPath: string, errorMessage?: string): never {
  if (!errorMessage) {
    redirect(returnPath);
  }

  const target = new URL(returnPath, "https://egawilldoit.online");
  target.searchParams.set("actionError", errorMessage);
  redirect(`${target.pathname}${target.search}`);
}

export async function startTimerAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const result = await startTimerForTask(taskId);
  if (result.errorMessage) {
    redirectToTimer(returnPath, result.errorMessage);
  }

  revalidatePath("/timer");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/today");
  redirectToTimer(returnPath);
}

export async function stopTimerAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const submittedSessionId = String(formData.get("sessionId") ?? "").trim();
  const result = await stopTimerSession({ sessionId: submittedSessionId });
  if (result.errorMessage) {
    redirectToTimer(returnPath, result.errorMessage);
  }

  revalidatePath("/timer");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/today");
  redirectToTimer(returnPath);
}

export async function resolveSessionConflictAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const result = await resolveOpenTimerSessionConflict();
  if (result.errorMessage) {
    redirectToTimer(returnPath, result.errorMessage);
  }

  revalidatePath("/timer");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/today");
  redirectToTimer(returnPath);
}
