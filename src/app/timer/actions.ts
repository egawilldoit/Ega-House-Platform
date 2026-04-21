"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { buildTimerRedirectHref } from "@/app/timer/flash-query";
import { getTimerActionReturnPath } from "@/app/timer/return-path";
import { getTaskById, updateTaskInline } from "@/lib/services/task-service";
import { isTaskPriority } from "@/lib/task-domain";
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
    stoppedTaskId?: string;
  },
): never {
  const target = new URL(
    buildTimerRedirectHref(returnPath, options),
    "https://egawilldoit.online",
  );
  if (options?.stoppedTaskId) {
    target.searchParams.set("stoppedTaskId", options.stoppedTaskId);
  } else {
    target.searchParams.delete("stoppedTaskId");
  }
  redirect(`${target.pathname}${target.search}${target.hash}`);
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
  redirectToTimer(returnPath, {
    successMessage: "Timer stopped.",
    stoppedTaskId: result.stoppedTaskId ?? undefined,
  });
}

type CompleteStoppedTaskDependencies = {
  getTaskById: typeof getTaskById;
  updateTaskInline: typeof updateTaskInline;
};

export async function completeStoppedTaskById(
  taskId: string,
  dependencies: CompleteStoppedTaskDependencies = {
    getTaskById,
    updateTaskInline,
  },
) {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return { errorMessage: "Task update request is invalid." };
  }

  const taskResult = await dependencies.getTaskById(normalizedTaskId);
  if (taskResult.errorMessage) {
    return { errorMessage: taskResult.errorMessage };
  }

  if (!taskResult.data) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  const updateResult = await dependencies.updateTaskInline({
    taskId: taskResult.data.id,
    status: "done",
    priority: isTaskPriority(taskResult.data.priority)
      ? taskResult.data.priority
      : "medium",
    dueDate: taskResult.data.due_date,
    estimateMinutes: taskResult.data.estimate_minutes,
    blockedReason: taskResult.data.blocked_reason,
  });

  return updateResult;
}

export async function completeStoppedTaskAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const result = await completeStoppedTaskById(taskId);

  if (result.errorMessage) {
    redirectToTimer(returnPath, {
      errorMessage: result.errorMessage,
      stoppedTaskId: taskId || undefined,
    });
  }

  revalidateTimerSurfaces(returnPath);
  redirectToTimer(returnPath, { successMessage: "Task marked done." });
}

export async function dismissStoppedTaskPromptAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
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
