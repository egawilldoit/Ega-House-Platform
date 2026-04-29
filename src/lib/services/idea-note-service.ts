import { createClient } from "@/lib/supabase/server";
import type { Tables, TablesInsert } from "@/lib/supabase/database.types";
import {
  DEFAULT_IDEA_NOTE_TYPE,
  IDEA_NOTE_PRIORITIES,
  IDEA_NOTE_TYPES,
  normalizeIdeaNotePriority,
  normalizeOptionalProjectId,
  parseIdeaNoteTags,
  validateIdeaNoteType,
} from "@/lib/idea-note-domain";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type IdeaNote = Pick<
  Tables<"idea_notes">,
  | "id"
  | "title"
  | "body"
  | "status"
  | "type"
  | "project_id"
  | "priority"
  | "tags"
  | "created_at"
  | "updated_at"
> & {
  projects?: Pick<Tables<"projects">, "name"> | null;
};

export { DEFAULT_IDEA_NOTE_TYPE, IDEA_NOTE_PRIORITIES, IDEA_NOTE_TYPES };

export type IdeaNoteProjectOption = Pick<Tables<"projects">, "id" | "name">;

export type CreateIdeaNoteInput = {
  title: unknown;
  body?: unknown;
  type?: unknown;
  projectId?: unknown;
  priority?: unknown;
  tagsInput?: unknown;
  tags?: unknown;
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
  const type = validateIdeaNoteType(input.type);
  const projectId = normalizeOptionalProjectId(input.projectId);
  const rawPriority = String(input.priority ?? "").trim();
  const priority = normalizeIdeaNotePriority(input.priority);
  let tags: string[];

  try {
    tags = parseIdeaNoteTags(input.tags ?? input.tagsInput ?? "");
  } catch (error) {
    return {
      title,
      body: body.length > 0 ? body : null,
      type,
      projectId,
      priority,
      tags: [],
      errorMessage: error instanceof Error ? error.message : "Tags are invalid.",
    };
  }

  return {
    title,
    body: body.length > 0 ? body : null,
    type,
    projectId,
    priority,
    tags,
    errorMessage:
      type === null
        ? `Type must be one of: ${IDEA_NOTE_TYPES.join(", ")}.`
        : projectId === ""
          ? "Project is invalid."
          : rawPriority && priority === null
            ? `Priority must be one of: ${IDEA_NOTE_PRIORITIES.join(", ")}.`
            : null,
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

  if (normalized.errorMessage) {
    return {
      errorMessage: normalized.errorMessage,
      data: null,
    };
  }

  if (normalized.projectId) {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", normalized.projectId)
      .maybeSingle();

    if (projectError || !project) {
      return {
        errorMessage: "Selected project is unavailable.",
        data: null,
      };
    }
  }

  const row = {
    title: normalized.title,
    body: normalized.body,
    status: "inbox",
    type: normalized.type ?? DEFAULT_IDEA_NOTE_TYPE,
    project_id: normalized.projectId || null,
    priority: normalized.priority,
    tags: normalized.tags,
  } satisfies TablesInsert<"idea_notes">;

  const { data, error } = await supabase
    .from("idea_notes")
    .insert(row)
    .select(
      "id, title, body, status, type, project_id, priority, tags, created_at, updated_at, projects(name)",
    )
    .single();

  if (error) {
    return {
      errorMessage: "Unable to create idea right now.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: data as IdeaNote,
  };
}

export async function getIdeaInboxNotes(options?: {
  supabase?: SupabaseServerClient;
}): Promise<IdeaNote[]> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const { data, error } = await supabase
    .from("idea_notes")
    .select(
      "id, title, body, status, type, project_id, priority, tags, created_at, updated_at, projects(name)",
    )
    .eq("status", "inbox")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load ideas: ${error.message}`);
  }

  return (data ?? []) as IdeaNote[];
}

export async function getIdeaNoteProjectOptions(options?: {
  supabase?: SupabaseServerClient;
}): Promise<IdeaNoteProjectOption[]> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const { data, error } = await supabase
    .from("projects")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load projects: ${error.message}`);
  }

  return data ?? [];
}
