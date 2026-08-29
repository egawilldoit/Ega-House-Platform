"use server";

import { revalidatePath } from "next/cache";

import { createIdeaNote } from "@/lib/services/idea-note-service";

export type InboxCaptureResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function captureInboxIdea(input: {
  title: string;
  body?: string | null;
  idempotencyKey?: string | null;
}): Promise<InboxCaptureResult> {
  const title = String(input.title ?? "").trim();
  if (!title) {
    return { ok: false, error: "Title is required." };
  }

  const result = await createIdeaNote(
    {
      title,
      body: input.body ?? null,
      idempotencyKey: input.idempotencyKey ?? undefined,
    },
    // createIdeaNote will handle its own supabase resolution
  );

  if (result.errorMessage) {
    return { ok: false, error: result.errorMessage };
  }

  if (!result.data) {
    return { ok: false, error: "Unable to capture idea right now." };
  }

  revalidatePath("/ideas");
  revalidatePath("/dashboard");

  return { ok: true, id: result.data.id };
}
