"use server";

import { revalidateWorkspaceFor } from "@/lib/workspace/workspace-navigation";
import {
  createTaskCommentForOwner,
  deleteTaskCommentForOwner,
  toggleTaskCommentReactionForOwner,
  updateTaskCommentForOwner,
} from "@/lib/services/task-comment-service";
import type { TaskCommentReaction } from "@ega/contracts";

export type TaskCommentActionResult = {
  ok: boolean;
  errorMessage: string | null;
  /** Echoed so a failed retry keeps the same idempotency key. */
  requestId?: string;
};

export type TaskCommentReactionActionResult = {
  ok: boolean;
  errorMessage: string | null;
  reactions?: TaskCommentReaction[];
};

function stringValue(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

function revalidate(returnTo: string) {
  revalidateWorkspaceFor("task", {
    returnTo: returnTo.trim() || "/tasks",
  });
}

export async function createTaskCommentAction(
  _previousState: TaskCommentActionResult,
  formData: FormData,
): Promise<TaskCommentActionResult> {
  const requestId = stringValue(formData, "clientRequestId").trim();
  const result = await createTaskCommentForOwner({
    taskId: stringValue(formData, "taskId").trim(),
    body: stringValue(formData, "body"),
    clientRequestId: requestId,
  });

  if (result.errorMessage) {
    return { ok: false, errorMessage: result.errorMessage, requestId };
  }

  revalidate(stringValue(formData, "returnTo"));
  return { ok: true, errorMessage: null, requestId };
}

export async function updateTaskCommentAction(
  formData: FormData,
): Promise<TaskCommentActionResult> {
  const result = await updateTaskCommentForOwner({
    commentId: stringValue(formData, "commentId").trim(),
    body: stringValue(formData, "body"),
  });

  if (result.errorMessage) {
    return { ok: false, errorMessage: result.errorMessage };
  }

  revalidate(stringValue(formData, "returnTo"));
  return { ok: true, errorMessage: null };
}

export async function deleteTaskCommentAction(
  formData: FormData,
): Promise<TaskCommentActionResult> {
  const result = await deleteTaskCommentForOwner(
    stringValue(formData, "commentId").trim(),
  );

  if (result.errorMessage) {
    return { ok: false, errorMessage: result.errorMessage };
  }

  revalidate(stringValue(formData, "returnTo"));
  return { ok: true, errorMessage: null };
}

export async function toggleTaskCommentReactionAction(
  formData: FormData,
): Promise<TaskCommentReactionActionResult> {
  const result = await toggleTaskCommentReactionForOwner({
    commentId: stringValue(formData, "commentId").trim(),
    emoji: stringValue(formData, "emoji"),
  });

  if (result.errorMessage || !result.data) {
    return {
      ok: false,
      errorMessage: result.errorMessage ?? "Unable to update the reaction right now.",
    };
  }

  revalidate(stringValue(formData, "returnTo"));
  return { ok: true, errorMessage: null, reactions: result.data };
}
