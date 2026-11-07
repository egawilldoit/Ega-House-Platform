import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";

/**
 * Owner-scoped options for the durable `jobSearchReference` preference.
 *
 * Reads through the request-scoped Supabase client so RLS applies, and also
 * filters explicitly by the verified owner id. Archived tasks are included
 * (labelled in the form) because an archived task id remains a stable
 * historical reference.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type JobSearchReferenceProjectOption = Readonly<{
  id: string;
  name: string;
}>;

export type JobSearchReferenceTaskOption = Readonly<{
  id: string;
  title: string;
  archivedAt: string | null;
}>;

export type JobSearchReferenceOptions = Readonly<{
  projects: JobSearchReferenceProjectOption[];
  tasks: JobSearchReferenceTaskOption[];
}>;

export type JobSearchReferenceOptionsResult = Readonly<{
  data: JobSearchReferenceOptions;
  errorMessage: string | null;
}>;

const EMPTY_OPTIONS: JobSearchReferenceOptions = { projects: [], tasks: [] };
const LOAD_FAILURE =
  "Could not load job-search references. Check your connection and try again.";

export async function getJobSearchReferenceOptions(options: {
  supabase?: SupabaseServerClient;
  getCurrentUser?: () => Promise<{ id: string } | null>;
} = {}): Promise<JobSearchReferenceOptionsResult> {
  try {
    const user = await (options.getCurrentUser ?? getCurrentUser)();
    if (!user) {
      return {
        data: EMPTY_OPTIONS,
        errorMessage: "Sign in to load job-search references.",
      };
    }

    const supabase = options.supabase ?? (await createClient());
    const [projectsResult, tasksResult] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name")
        .eq("owner_user_id", user.id)
        .order("name", { ascending: true })
        .limit(200),
      supabase
        .from("tasks")
        .select("id, title, archived_at")
        .eq("owner_user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(200),
    ]);

    if (projectsResult.error || tasksResult.error) {
      return { data: EMPTY_OPTIONS, errorMessage: LOAD_FAILURE };
    }

    const projects: JobSearchReferenceProjectOption[] = [];
    for (const row of projectsResult.data ?? []) {
      if (typeof row.id !== "string" || typeof row.name !== "string") continue;
      projects.push({ id: row.id, name: row.name });
    }

    const tasks: JobSearchReferenceTaskOption[] = [];
    for (const row of tasksResult.data ?? []) {
      if (typeof row.id !== "string" || typeof row.title !== "string") continue;
      tasks.push({
        id: row.id,
        title: row.title,
        archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
      });
    }

    return { data: { projects, tasks }, errorMessage: null };
  } catch {
    return { data: EMPTY_OPTIONS, errorMessage: LOAD_FAILURE };
  }
}
