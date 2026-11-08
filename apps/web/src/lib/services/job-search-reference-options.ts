import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";

/**
 * Owner-scoped task options for the durable `jobSearchReference` preference.
 *
 * Reads through the request-scoped Supabase client so RLS applies, and also
 * filters explicitly by the verified owner id. Archived tasks are included
 * (labelled in the form) because an archived task id remains a stable
 * historical reference. Project references are deliberately deferred.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type JobSearchReferenceTaskOption = Readonly<{
  id: string;
  title: string;
  archivedAt: string | null;
}>;

export type JobSearchReferenceOptions = Readonly<{
  tasks: JobSearchReferenceTaskOption[];
}>;

export type JobSearchReferenceOptionsResult = Readonly<{
  data: JobSearchReferenceOptions;
  errorMessage: string | null;
}>;

const EMPTY_OPTIONS: JobSearchReferenceOptions = { tasks: [] };
const LOAD_FAILURE =
  "Could not load job-search tasks. Check your connection and try again.";

export async function getJobSearchReferenceOptions(options: {
  supabase?: SupabaseServerClient;
  getCurrentUser?: () => Promise<{ id: string } | null>;
} = {}): Promise<JobSearchReferenceOptionsResult> {
  try {
    const user = await (options.getCurrentUser ?? getCurrentUser)();
    if (!user) {
      return { data: EMPTY_OPTIONS, errorMessage: "Sign in to load job-search tasks." };
    }

    const supabase = options.supabase ?? (await createClient());
    const tasks: JobSearchReferenceTaskOption[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const result = await supabase
        .from("tasks")
        .select("id, title, archived_at")
        .eq("owner_user_id", user.id)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (result.error) return { data: EMPTY_OPTIONS, errorMessage: LOAD_FAILURE };
      const page = result.data ?? [];
      for (const row of page) {
        if (typeof row.id !== "string" || typeof row.title !== "string") continue;
        tasks.push({ id: row.id, title: row.title, archivedAt: typeof row.archived_at === "string" ? row.archived_at : null });
      }
      if (page.length < pageSize) break;
    }

    return { data: { tasks }, errorMessage: null };
  } catch {
    return { data: EMPTY_OPTIONS, errorMessage: LOAD_FAILURE };
  }
}
