"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type CreateProjectFormState = {
  error: string | null;
  values: {
    name: string;
    slug: string;
    description: string;
  };
};

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function createErrorState(
  message: string,
  values: CreateProjectFormState["values"],
): CreateProjectFormState {
  return {
    error: message,
    values,
  };
}

export async function createProjectAction(
  _previous: CreateProjectFormState,
  formData: FormData,
): Promise<CreateProjectFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const rawSlug = String(formData.get("slug") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const slug = normalizeSlug(rawSlug);

  const values = {
    name,
    slug,
    description,
  };

  if (!name) {
    return createErrorState("Project name is required.", values);
  }

  if (!slug) {
    return createErrorState("Slug is required.", values);
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return createErrorState(
      "Slug can only contain lowercase letters, numbers, and hyphens.",
      values,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("projects").insert({
    name,
    slug,
    description: description || null,
  });

  if (error) {
    const duplicateSlug =
      error.code === "23505" ||
      error.message
        .toLowerCase()
        .includes("projects_owner_user_id_slug_unique");

    if (duplicateSlug) {
      return createErrorState(
        "That slug is already in use. Choose a different slug.",
        values,
      );
    }

    return createErrorState(
      "Unable to create project right now. Please try again.",
      values,
    );
  }

  revalidatePath("/tasks/projects");
  redirect("/tasks/projects");
}
