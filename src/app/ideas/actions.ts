"use server";

import { revalidatePath } from "next/cache";

import { createIdeaNote } from "@/lib/services/idea-note-service";

export type CreateIdeaNoteFormState = {
  error: string | null;
  success: string | null;
  values: {
    title: string;
    body: string;
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
  const values = { title, body };

  if (!title) {
    return createErrorState("Idea title is required.", values);
  }

  const result = await createIdeaNote({ title, body });

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
    },
  };
}
