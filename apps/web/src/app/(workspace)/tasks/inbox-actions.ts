"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { convertInboxItemToTask, createAuthenticatedActor } from "@ega/application";
import { SupabaseInboxRepository, SupabaseTasksRepository } from "@ega/data-access";

import { archiveIdeaNote, restoreIdeaNote } from "@/lib/services/idea-note-service";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

export type TaskInboxItemFormState = {
  error: string | null;
  success: string | null;
};

function revalidateTaskSurfaces() {
  revalidatePath("/tasks");
  revalidatePath("/backlog");
  revalidatePath("/today");
}

export async function archiveTaskInboxItemAction(
  _previous: TaskInboxItemFormState,
  formData: FormData,
): Promise<TaskInboxItemFormState> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) {
    return { error: "Idea is required.", success: null };
  }

  const result = await archiveIdeaNote(id);
  if (result.errorMessage) {
    return { error: result.errorMessage, success: null };
  }

  revalidateTaskSurfaces();
  return { error: null, success: "Idea archived." };
}

export async function restoreTaskInboxItemAction(
  _previous: TaskInboxItemFormState,
  formData: FormData,
): Promise<TaskInboxItemFormState> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) {
    return { error: "Idea is required.", success: null };
  }

  const result = await restoreIdeaNote(id);
  if (result.errorMessage) {
    return { error: result.errorMessage, success: null };
  }

  revalidateTaskSurfaces();
  return { error: null, success: "Idea restored." };
}

export type ConvertTaskInboxItemFormState = {
  error: string | null;
};

export async function convertTaskInboxItemAction(
  _previous: ConvertTaskInboxItemFormState,
  formData: FormData,
): Promise<ConvertTaskInboxItemFormState> {
  const inboxItemId = String(formData.get("id") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();

  if (!inboxItemId) {
    return { error: "Idea is required." };
  }

  if (!projectId) {
    return { error: "Choose a project before turning this into a task." };
  }

  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const result = await convertInboxItemToTask(
    actor,
    new SupabaseInboxRepository(supabase),
    new SupabaseTasksRepository(supabase),
    { inboxItemId, projectId },
  );

  if (!result.ok) {
    return { error: result.errorMessage };
  }

  revalidateTaskSurfaces();
  redirect(`/tasks#task-${result.data.task.id}`);
}
