import { createClient } from "@/lib/supabase/server";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import {
  DEFAULT_IDEA_NOTE_TYPE,
  type IdeaNotePriority,
  type IdeaNoteStatus,
  type IdeaNoteType,
  type ManualIdeaNoteStatus,
  IDEA_NOTE_PRIORITIES,
  MANUAL_IDEA_NOTE_STATUSES,
  IDEA_NOTE_TYPES,
  isManualIdeaNoteStatus,
  isIdeaNoteType,
  normalizeIdeaNotePriority,
  normalizeOptionalProjectId,
  parseIdeaNoteTags,
  validateManualIdeaNoteStatus,
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
export { MANUAL_IDEA_NOTE_STATUSES };

export type IdeaNoteProjectOption = Pick<Tables<"projects">, "id" | "name">;
export type IdeaNoteListView = "active" | "archived" | "all";
export type IdeaNoteListFilters = {
  view?: IdeaNoteListView;
  search?: string;
  type?: IdeaNoteType | "all" | string;
  status?: ManualIdeaNoteStatus | "all" | string;
  project?: string | "none" | "all";
  priority?: IdeaNotePriority | "none" | "all" | string;
  tag?: string;
};

const ACTIVE_IDEA_NOTE_STATUSES = ["inbox", "reviewing", "planned"] as const satisfies readonly IdeaNoteStatus[];
const ALL_VISIBLE_IDEA_NOTE_STATUSES = [
  ...ACTIVE_IDEA_NOTE_STATUSES,
  "archived",
] as const satisfies readonly IdeaNoteStatus[];
const IDEA_NOTE_LIST_VIEWS = ["active", "archived", "all"] as const satisfies readonly IdeaNoteListView[];

export type CreateIdeaNoteInput = {
  title: unknown;
  body?: unknown;
  type?: unknown;
  projectId?: unknown;
  priority?: unknown;
  tagsInput?: unknown;
  tags?: unknown;
};

export type UpdateIdeaNoteInput = CreateIdeaNoteInput & {
  id: unknown;
  status: unknown;
};

export type IdeaNoteMutationResult =
  | {
      errorMessage: null;
      data: IdeaNote | null;
    }
  | {
      errorMessage: string;
      data: null;
    };

export type CreateIdeaNoteResult = IdeaNoteMutationResult;
export type UpdateIdeaNoteResult = IdeaNoteMutationResult;
export type ArchiveIdeaNoteResult = IdeaNoteMutationResult;
export type RestoreIdeaNoteResult = IdeaNoteMutationResult;

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

function normalizeIdeaNoteId(value: unknown) {
  const id = String(value ?? "").trim();
  return {
    id,
    errorMessage: id ? null : "Idea is required.",
  };
}

function normalizeIdeaNoteListView(value: unknown): IdeaNoteListView {
  const normalized = String(value ?? "").trim().toLowerCase();
  return IDEA_NOTE_LIST_VIEWS.includes(normalized as IdeaNoteListView)
    ? (normalized as IdeaNoteListView)
    : "active";
}

function escapePostgrestPattern(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function normalizeIdeaNoteListFilters(filters?: IdeaNoteListFilters): Required<IdeaNoteListFilters> {
  const search = String(filters?.search ?? "").trim();
  const type = String(filters?.type ?? "").trim().toLowerCase();
  const status = String(filters?.status ?? "").trim().toLowerCase();
  const project = String(filters?.project ?? "").trim();
  const projectId = normalizeOptionalProjectId(project);
  const priority = String(filters?.priority ?? "").trim().toLowerCase();
  let parsedTags: string[] = [];

  try {
    parsedTags = parseIdeaNoteTags(filters?.tag ?? "");
  } catch {
    parsedTags = [];
  }

  return {
    view: normalizeIdeaNoteListView(filters?.view),
    search,
    type: type && type !== "all" && isIdeaNoteType(type) ? type : "all",
    status: status && status !== "all" && isManualIdeaNoteStatus(status) ? status : "all",
    project: project === "none" ? "none" : projectId || "all",
    priority:
      priority && priority !== "all" && priority !== "none"
        ? normalizeIdeaNotePriority(priority) ?? "all"
        : priority === "none"
          ? "none"
          : "all",
    tag: parsedTags[0] ?? "",
  };
}

async function ensureProjectVisible(
  supabase: SupabaseServerClient,
  projectId: string | null,
): Promise<string | null> {
  if (!projectId) return null;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    return "Selected project is unavailable.";
  }

  return null;
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

  const projectError = await ensureProjectVisible(supabase, normalized.projectId || null);
  if (projectError) {
    return {
      errorMessage: projectError,
      data: null,
    };
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

export async function updateIdeaNote(
  input: UpdateIdeaNoteInput,
  options?: { supabase?: SupabaseServerClient },
): Promise<UpdateIdeaNoteResult> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalizedId = normalizeIdeaNoteId(input.id);
  const normalized = normalizeIdeaNoteInput(input);
  const statusResult = validateManualIdeaNoteStatus(input.status);

  if (normalizedId.errorMessage) {
    return {
      errorMessage: normalizedId.errorMessage,
      data: null,
    };
  }

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

  if (statusResult.status === null) {
    return {
      errorMessage: statusResult.errorMessage,
      data: null,
    };
  }

  const projectError = await ensureProjectVisible(supabase, normalized.projectId || null);
  if (projectError) {
    return {
      errorMessage: projectError,
      data: null,
    };
  }

  const row = {
    title: normalized.title,
    body: normalized.body,
    status: statusResult.status,
    type: normalized.type ?? DEFAULT_IDEA_NOTE_TYPE,
    project_id: normalized.projectId || null,
    priority: normalized.priority,
    tags: normalized.tags,
    updated_at: new Date().toISOString(),
  } satisfies TablesUpdate<"idea_notes">;

  const { data, error } = await supabase
    .from("idea_notes")
    .update(row)
    .eq("id", normalizedId.id)
    .select(
      "id, title, body, status, type, project_id, priority, tags, created_at, updated_at, projects(name)",
    )
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to update idea right now.",
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: "Idea is unavailable.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: data as IdeaNote,
  };
}

async function updateIdeaNoteStatus(
  idInput: unknown,
  status: "archived" | "inbox",
  errorMessage: string,
  options?: { supabase?: SupabaseServerClient },
): Promise<IdeaNoteMutationResult> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalizedId = normalizeIdeaNoteId(idInput);

  if (normalizedId.errorMessage) {
    return {
      errorMessage: normalizedId.errorMessage,
      data: null,
    };
  }

  const row = {
    status,
    updated_at: new Date().toISOString(),
  } satisfies TablesUpdate<"idea_notes">;

  const { data, error } = await supabase
    .from("idea_notes")
    .update(row)
    .eq("id", normalizedId.id)
    .select(
      "id, title, body, status, type, project_id, priority, tags, created_at, updated_at, projects(name)",
    )
    .maybeSingle();

  if (error) {
    return {
      errorMessage,
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: "Idea is unavailable.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: data as IdeaNote,
  };
}

export async function archiveIdeaNote(
  id: unknown,
  options?: { supabase?: SupabaseServerClient },
): Promise<ArchiveIdeaNoteResult> {
  return updateIdeaNoteStatus(id, "archived", "Unable to archive idea right now.", options);
}

export async function restoreIdeaNote(
  id: unknown,
  options?: { supabase?: SupabaseServerClient },
): Promise<RestoreIdeaNoteResult> {
  return updateIdeaNoteStatus(id, "inbox", "Unable to restore idea right now.", options);
}

export async function getIdeaInboxNotes(options?: {
  supabase?: SupabaseServerClient;
  view?: IdeaNoteListView;
  filters?: IdeaNoteListFilters;
}): Promise<IdeaNote[]> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const filters = normalizeIdeaNoteListFilters({ ...options?.filters, view: options?.filters?.view ?? options?.view });
  const view = filters.view;
  let query = supabase
    .from("idea_notes")
    .select(
      "id, title, body, status, type, project_id, priority, tags, created_at, updated_at, projects(name)",
    );

  if (view === "archived") {
    query = query.eq("status", "archived");
  } else if (view === "all") {
    query = query.in("status", [...ALL_VISIBLE_IDEA_NOTE_STATUSES]);
  } else {
    query = query.in("status", [...ACTIVE_IDEA_NOTE_STATUSES]);
  }

  if (filters.search) {
    const pattern = `%${escapePostgrestPattern(filters.search)}%`;
    query = query.or(`title.ilike.${pattern},body.ilike.${pattern}`);
  }

  if (filters.type !== "all") {
    query = query.eq("type", filters.type);
  }

  if (filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.project === "none") {
    query = query.is("project_id", null);
  } else if (filters.project !== "all") {
    query = query.eq("project_id", filters.project);
  }

  if (filters.priority === "none") {
    query = query.is("priority", null);
  } else if (filters.priority !== "all") {
    query = query.eq("priority", filters.priority);
  }

  if (filters.tag) {
    query = query.contains("tags", [filters.tag]);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

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
