"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { convertInboxItemToTask, createAuthenticatedActor } from "@ega/application";
import { SupabaseInboxRepository, SupabaseTasksRepository } from "@ega/data-access";

import {
  archiveIdeaNote,
  restoreIdeaNote,
  updateIdeaNote,
} from "@/lib/services/idea-note-service";
import { DEFAULT_IDEA_NOTE_TYPE } from "@/lib/idea-note-domain";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

export type UpdateBacklogItemFormState = {
  error: string | null;
  success: string | null;
};

export type BacklogArchiveFormState = UpdateBacklogItemFormState;

export type ConvertBacklogItemFormState = {
  error: string | null;
};

function createUpdateErrorState(error: string): UpdateBacklogItemFormState {
  return { error, success: null };
}

export async function updateBacklogItemAction(
  _previous: UpdateBacklogItemFormState,
  formData: FormData,
): Promise<UpdateBacklogItemFormState> {
  const id = String(formData.get("id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const type = String(formData.get("type") ?? DEFAULT_IDEA_NOTE_TYPE).trim();
  const priority = String(formData.get("priority") ?? "").trim();
  const tagsInput = String(formData.get("tagsInput") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  if (!title) {
    return createUpdateErrorState("Title is required.");
  }

  const result = await updateIdeaNote({
    id,
    title,
    body,
    type,
    projectId,
    priority,
    tagsInput,
    status,
  });

  if (result.errorMessage) {
    return createUpdateErrorState(result.errorMessage);
  }

  revalidatePath("/backlog");

  return {
    error: null,
    success: "Backlog item updated.",
  };
}

export async function archiveBacklogItemAction(
  _previous: BacklogArchiveFormState,
  formData: FormData,
): Promise<BacklogArchiveFormState> {
  const id = String(formData.get("id") ?? "").trim();
  const result = await archiveIdeaNote(id);

  if (result.errorMessage) {
    return createUpdateErrorState(result.errorMessage);
  }

  revalidatePath("/backlog");

  return {
    error: null,
    success: "Backlog item archived.",
  };
}

export async function restoreBacklogItemAction(
  _previous: BacklogArchiveFormState,
  formData: FormData,
): Promise<BacklogArchiveFormState> {
  const id = String(formData.get("id") ?? "").trim();
  const result = await restoreIdeaNote(id);

  if (result.errorMessage) {
    return createUpdateErrorState(result.errorMessage);
  }

  revalidatePath("/backlog");

  return {
    error: null,
    success: "Backlog item restored.",
  };
}

export async function convertBacklogItemAction(
  _previous: ConvertBacklogItemFormState,
  formData: FormData,
): Promise<ConvertBacklogItemFormState> {
  const inboxItemId = String(formData.get("id") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();

  if (!inboxItemId) {
    return { error: "Backlog item is required." };
  }

  if (!projectId) {
    return { error: "Choose a project before turning this into a task." };
  }

  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const inboxRepository = new SupabaseInboxRepository(supabase);
  const tasksRepository = new SupabaseTasksRepository(supabase);
  const result = await convertInboxItemToTask(actor, inboxRepository, tasksRepository, {
    inboxItemId,
    projectId,
  });

  if (!result.ok) {
    return { error: result.errorMessage };
  }

  revalidatePath("/backlog");
  revalidatePath("/tasks");
  revalidatePath("/today");
  redirect(`/tasks#task-${result.data.task.id}`);
}
