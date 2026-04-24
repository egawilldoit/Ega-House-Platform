"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { buildTimerRedirectHref } from "@/app/timer/flash-query";
import { getTimerActionReturnPath } from "@/app/timer/return-path";
import { getTaskById, updateTaskInline } from "@/lib/services/task-service";
import { isTaskPriority, type TaskStatus } from "@/lib/task-domain";
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
    successMessage: result.stoppedTaskId
      ? "Timer stopped. Choose the task outcome."
      : "Timer stopped.",
    stoppedTaskId: result.stoppedTaskId ?? undefined,
  });
}

type StoppedTimerOutcome = "done" | "in_progress" | "blocked" | "no_change";

type HandleStoppedTimerOutcomeDependencies = {
  getTaskById: typeof getTaskById;
  updateTaskInline: typeof updateTaskInline;
};

function getStoppedTimerOutcomeStatus(outcome: StoppedTimerOutcome): TaskStatus | null {
  if (outcome === "done") {
    return "done";
  }

  if (outcome === "blocked") {
    return "blocked";
  }

  if (outcome === "in_progress") {
    return "in_progress";
  }

  return null;
}

function parseStoppedTimerOutcome(value: unknown): StoppedTimerOutcome | null {
  const normalizedValue = String(value ?? "").trim();
  if (
    normalizedValue === "done" ||
    normalizedValue === "in_progress" ||
    normalizedValue === "blocked" ||
    normalizedValue === "no_change"
  ) {
    return normalizedValue;
  }

  return null;
}

export async function handleStoppedTimerOutcomeByTaskId(
  taskId: string,
  outcome: StoppedTimerOutcome,
  blockedReason: unknown = null,
  dependencies: HandleStoppedTimerOutcomeDependencies = {
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

  const nextStatus = getStoppedTimerOutcomeStatus(outcome);
  if (!nextStatus) {
    return { errorMessage: null };
  }

  const normalizedBlockedReason = String(blockedReason ?? "").trim();
  if (nextStatus === "blocked" && !normalizedBlockedReason) {
    return { errorMessage: "Blocked reason is required when status is Blocked." };
  }

  const updateResult = await dependencies.updateTaskInline({
    taskId: taskResult.data.id,
    status: nextStatus,
    priority: isTaskPriority(taskResult.data.priority)
      ? taskResult.data.priority
      : "medium",
    dueDate: taskResult.data.due_date,
    estimateMinutes: taskResult.data.estimate_minutes,
    blockedReason: nextStatus === "blocked" ? normalizedBlockedReason : null,
  });

  return updateResult;
}

export async function completeStoppedTaskById(
  taskId: string,
  dependencies: HandleStoppedTimerOutcomeDependencies = {
    getTaskById,
    updateTaskInline,
  },
) {
  return handleStoppedTimerOutcomeByTaskId(
    taskId,
    "done",
    null,
    dependencies,
  );
}

export async function submitStoppedTimerOutcomeAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const outcome = parseStoppedTimerOutcome(formData.get("outcome"));

  if (!outcome) {
    redirectToTimer(returnPath, {
      errorMessage: "Choose a task outcome.",
      stoppedTaskId: taskId || undefined,
    });
  }

  const result = await handleStoppedTimerOutcomeByTaskId(
    taskId,
    outcome,
    formData.get("blockedReason"),
  );

  if (result.errorMessage) {
    redirectToTimer(returnPath, {
      errorMessage: result.errorMessage,
      stoppedTaskId: taskId || undefined,
    });
  }

  revalidateTimerSurfaces(returnPath);
  redirectToTimer(returnPath, {
    successMessage:
      outcome === "no_change"
        ? "Timer stopped. Task status unchanged."
        : "Timer stopped. Task updated.",
  });
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
