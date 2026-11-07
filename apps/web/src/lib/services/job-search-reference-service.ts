import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";

/**
 * Save-time ownership check for the task-only job-search reference.
 *
 * The client sends only an id. The task must exist for the verified owner;
 * a foreign or unknown id is rejected with an actionable message instead of
 * being persisted.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const VERIFY_FAILURE = "Unable to verify that task right now.";
const NOT_AVAILABLE = "That task is not available in your workspace.";

export async function verifyJobSearchReferenceTask(options: {
  taskId: string;
  supabase?: SupabaseServerClient;
  getCurrentUser?: () => Promise<{ id: string } | null>;
}): Promise<{ ok: boolean; errorMessage: string | null }> {
  try {
    const user = await (options.getCurrentUser ?? getCurrentUser)();
    if (!user) {
      return { ok: false, errorMessage: "Sign in to save a job-search task." };
    }

    const taskId = typeof options.taskId === "string" ? options.taskId.trim() : "";
    if (!taskId) {
      return { ok: false, errorMessage: "Choose a valid task for job search." };
    }

    const supabase = options.supabase ?? (await createClient());
    const { data, error } = await supabase
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (error) return { ok: false, errorMessage: VERIFY_FAILURE };
    if (!data) return { ok: false, errorMessage: NOT_AVAILABLE };
    return { ok: true, errorMessage: null };
  } catch {
    return { ok: false, errorMessage: VERIFY_FAILURE };
  }
}
