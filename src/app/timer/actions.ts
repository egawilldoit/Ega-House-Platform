"use server";

import { getTimerActionReturnPath } from "@/app/timer/return-path";
import {
  blockTask,
  markTaskDone,
  resumeTask,
} from "@/lib/services/task-transition-service";
import {
  resolveOpenTimerSessionConflict,
  startTimerForTask,
  stopTimerSession,
  updateTimerSessionTimestamps,
} from "@/lib/services/timer-service";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

function redirectToTimer(
  returnPath: string,
  options?: {
    errorMessage?: string;
    successMessage?: string;
    anchor?: string;
    stoppedTaskId?: string;
  },
): never {
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: options?.anchor ? options.anchor.replace(/^#/, "") : undefined,
    clearStoppedTaskId: true,
    errorMessage: options?.errorMessage,
    stoppedTaskId: options?.stoppedTaskId,
    successMessage: options?.successMessage,
  });
}

export async function startTimerAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const result = await startTimerForTask(taskId);
  if (result.errorMessage) {
    redirectToTimer(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("timer", { returnTo: returnPath });
  redirectToTimer(returnPath);
}

export async function stopTimerAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const submittedSessionId = String(formData.get("sessionId") ?? "").trim();
  const result = await stopTimerSession({ sessionId: submittedSessionId });
  if (result.errorMessage) {
    redirectToTimer(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("timer", { returnTo: returnPath });
  redirectToTimer(returnPath, {
    successMessage: result.stoppedTaskId
      ? "Timer stopped. Choose the task outcome."
      : "Timer stopped.",
    stoppedTaskId: result.stoppedTaskId ?? undefined,
  });
}

type StoppedTimerOutcome = "done" | "in_progress" | "blocked" | "no_change";

type HandleStoppedTimerOutcomeDependencies = {
  markTaskDone: typeof markTaskDone;
  resumeTask: typeof resumeTask;
  blockTask: typeof blockTask;
};

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
    markTaskDone,
    resumeTask,
    blockTask,
  },
) {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return { errorMessage: "Task update request is invalid." };
  }

  if (outcome === "no_change") {
    return { errorMessage: null };
  }

  if (outcome === "done") {
    return dependencies.markTaskDone(normalizedTaskId);
  }

  if (outcome === "in_progress") {
    return dependencies.resumeTask(normalizedTaskId);
  }

  const normalizedBlockedReason = String(blockedReason ?? "").trim();
  if (!normalizedBlockedReason) {
    return { errorMessage: "Blocked reason is required when status is Blocked." };
  }

  return dependencies.blockTask(normalizedTaskId, normalizedBlockedReason);
}

export async function completeStoppedTaskById(
  taskId: string,
  dependencies: HandleStoppedTimerOutcomeDependencies = {
    markTaskDone,
    resumeTask,
    blockTask,
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

  revalidateWorkspaceFor("timer", { returnTo: returnPath });
  redirectToTimer(returnPath, {
    successMessage:
      outcome === "no_change"
        ? "Timer stopped. Task status unchanged."
        : "Timer stopped. Task updated.",
  });
}

export async function resolveSessionConflictAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const result = await resolveOpenTimerSessionConflict();
  if (result.errorMessage) {
    redirectToTimer(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("timer", { returnTo: returnPath });
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

  revalidateWorkspaceFor("timer", { returnTo: returnPath });
  redirectToTimer(returnPath, {
    successMessage: "Session timing updated.",
    anchor: timerAnchor,
  });
}
