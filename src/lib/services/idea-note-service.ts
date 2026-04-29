import { createClient } from "@/lib/supabase/server";
import type { Tables, TablesInsert } from "@/lib/supabase/database.types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type IdeaNote = Pick<
  Tables<"idea_notes">,
  "id" | "title" | "body" | "status" | "created_at" | "updated_at"
>;

export type CreateIdeaNoteInput = {
  title: unknown;
  body?: unknown;
};

export type CreateIdeaNoteResult =
  | {
      errorMessage: null;
      data: IdeaNote | null;
    }
  | {
      errorMessage: string;
      data: null;
    };

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

export function normalizeIdeaNoteInput(input: CreateIdeaNoteInput) {
  const title = String(input.title ?? "").trim();
  const body = String(input.body ?? "").trim();

  return {
    title,
    body: body.length > 0 ? body : null,
  };
}

export async function createIdeaNote(
  input: CreateIdeaNoteInput,
  options?: { supabase?: SupabaseServerClient },
): Promise<CreateIdeaNoteResult> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalized = normalizeIdeaNoteInput(input);

  if (!normalized.title) {
    return {
      errorMessage: "Idea title is required.",
      data: null,
    };
  }

  const row = {
    title: normalized.title,
    body: normalized.body,
    status: "inbox",
  } satisfies TablesInsert<"idea_notes">;

  const { data, error } = await supabase
    .from("idea_notes")
    .insert(row)
    .select("id, title, body, status, created_at, updated_at")
    .single();

  if (error) {
    return {
      errorMessage: "Unable to create idea right now.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data,
  };
}

export async function getIdeaInboxNotes(options?: {
  supabase?: SupabaseServerClient;
}): Promise<IdeaNote[]> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const { data, error } = await supabase
    .from("idea_notes")
    .select("id, title, body, status, created_at, updated_at")
    .eq("status", "inbox")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load ideas: ${error.message}`);
  }

  return data ?? [];
}
