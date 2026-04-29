"use server";

import { revalidatePath } from "next/cache";

import { createIdeaNote } from "@/lib/services/idea-note-service";
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

function createErrorState(
  error: string,
  values: CreateIdeaNoteFormState["values"],
): CreateIdeaNoteFormState {
  return { error, success: null, values };
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
