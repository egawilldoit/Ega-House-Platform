"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { buildTimerRedirectHref } from "@/app/timer/flash-query";
import { getTimerActionReturnPath } from "@/app/timer/return-path";
import {
  resolveOpenTimerSessionConflict,
  startTimerForTask,
  stopTimerSession,
  updateTimerSessionTimestamps,
} from "@/lib/services/timer-service";

function getTimerPathname(returnPath: string) {
  return new URL(returnPath, "https://egawilldoit.online").pathname;
}

function revalidateTimerSurfaces(returnPath: string) {
  revalidatePath("/timer");
  revalidatePath(getTimerPathname(returnPath));
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/today");
  revalidatePath("/review");
}

function redirectToTimer(
  returnPath: string,
  options?: {
    errorMessage?: string;
    successMessage?: string;
    anchor?: string;
  },
): never {
  redirect(buildTimerRedirectHref(returnPath, options));
}

export async function startTimerAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const result = await startTimerForTask(taskId);
  if (result.errorMessage) {
    redirectToTimer(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateTimerSurfaces(returnPath);
  redirectToTimer(returnPath);
}

export async function stopTimerAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const submittedSessionId = String(formData.get("sessionId") ?? "").trim();
  const result = await stopTimerSession({ sessionId: submittedSessionId });
  if (result.errorMessage) {
    redirectToTimer(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateTimerSurfaces(returnPath);
  redirectToTimer(returnPath);
}

export async function resolveSessionConflictAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const result = await resolveOpenTimerSessionConflict();
  if (result.errorMessage) {
    redirectToTimer(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateTimerSurfaces(returnPath);
  redirectToTimer(returnPath);
}

export async function updateSessionTimingAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const sessionId = String(formData.get("sessionId") ?? "").trim();
  const startedAt = String(formData.get("startedAt") ?? "").trim();
  const endedAt = String(formData.get("endedAt") ?? "").trim();
  const timerAnchor = returnPath.startsWith("/timer") && sessionId ? `#session-${sessionId}` : "";

  const result = await updateTimerSessionTimestamps({
    sessionId,
    startedAt,
    endedAt,
  });

  if (result.errorMessage) {
    redirectToTimer(returnPath, {
      errorMessage: result.errorMessage,
      anchor: timerAnchor,
    });
  }

  revalidateTimerSurfaces(returnPath);
  redirectToTimer(returnPath, {
    successMessage: "Session timing updated.",
    anchor: timerAnchor,
  });
}
