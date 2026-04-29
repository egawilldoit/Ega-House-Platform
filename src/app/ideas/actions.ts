"use server";

import { revalidatePath } from "next/cache";

import {
  archiveIdeaNote,
  createIdeaNote,
  restoreIdeaNote,
  updateIdeaNote,
} from "@/lib/services/idea-note-service";
import { DEFAULT_IDEA_NOTE_TYPE } from "@/lib/idea-note-domain";

export type CreateIdeaNoteFormState = {
  error: string | null;
  success: string | null;
  values: {
    title: string;
    body: string;
    type: string;
    projectId: string;
    priority: string;
    tagsInput: string;
  };
};

export type UpdateIdeaNoteFormState = {
  error: string | null;
  success: string | null;
};

export type IdeaNoteArchiveFormState = UpdateIdeaNoteFormState;

function createErrorState(
  error: string,
  values: CreateIdeaNoteFormState["values"],
): CreateIdeaNoteFormState {
  return { error, success: null, values };
}

function createUpdateErrorState(error: string): UpdateIdeaNoteFormState {
  return { error, success: null };
}

export async function createIdeaNoteAction(
  _previous: CreateIdeaNoteFormState,
  formData: FormData,
): Promise<CreateIdeaNoteFormState> {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const type = String(formData.get("type") ?? DEFAULT_IDEA_NOTE_TYPE).trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const priority = String(formData.get("priority") ?? "").trim();
  const tagsInput = String(formData.get("tagsInput") ?? "").trim();
  const values = { title, body, type, projectId, priority, tagsInput };

  if (!title) {
    return createErrorState("Idea title is required.", values);
  }

  const result = await createIdeaNote({ title, body, type, projectId, priority, tagsInput });

  if (result.errorMessage) {
    return createErrorState(result.errorMessage, values);
  }

  revalidatePath("/ideas");

  return {
    error: null,
    success: "Idea captured.",
    values: {
      title: "",
      body: "",
      type: DEFAULT_IDEA_NOTE_TYPE,
      projectId: "",
      priority: "",
      tagsInput: "",
    },
  };
}

export async function updateIdeaNoteAction(
  _previous: UpdateIdeaNoteFormState,
  formData: FormData,
): Promise<UpdateIdeaNoteFormState> {
  const id = String(formData.get("id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const type = String(formData.get("type") ?? DEFAULT_IDEA_NOTE_TYPE).trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const priority = String(formData.get("priority") ?? "").trim();
  const tagsInput = String(formData.get("tagsInput") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  if (!title) {
    return createUpdateErrorState("Idea title is required.");
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

  revalidatePath("/ideas");

  return {
    error: null,
    success: "Idea updated.",
  };
}

export async function archiveIdeaNoteAction(
  _previous: IdeaNoteArchiveFormState,
  formData: FormData,
): Promise<IdeaNoteArchiveFormState> {
  const id = String(formData.get("id") ?? "").trim();
  const result = await archiveIdeaNote(id);

  if (result.errorMessage) {
    return createUpdateErrorState(result.errorMessage);
  }

  revalidatePath("/ideas");

  return {
    error: null,
    success: "Idea archived.",
  };
}

export async function restoreIdeaNoteAction(
  _previous: IdeaNoteArchiveFormState,
  formData: FormData,
): Promise<IdeaNoteArchiveFormState> {
  const id = String(formData.get("id") ?? "").trim();
  const result = await restoreIdeaNote(id);

  if (result.errorMessage) {
    return createUpdateErrorState(result.errorMessage);
  }

  revalidatePath("/ideas");

  return {
    error: null,
    success: "Idea restored.",
  };
}
