import { createClient } from "@/lib/supabase/server";

export type CreateProjectOption = { id: string; name: string };
export type CreateGoalOption = { id: string; title: string; project_id: string };

export type CreateOptions = {
  projects: CreateProjectOption[];
  goals: CreateGoalOption[];
  errorMessage: string | null;
};

/**
 * Bounded, request-scoped read used only when a global create surface opens.
 * The shell no longer loads these options eagerly; RLS keeps the rows scoped
 * to the authenticated owner.
 */
export async function getCreateOptions(options?: {
  supabase?: Awaited<ReturnType<typeof createClient>>;
}): Promise<CreateOptions> {
  const supabase = options?.supabase ?? (await createClient());
  const [projectsResult, goalsResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(24),
    supabase
      .from("goals")
      .select("id, title, project_id")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (projectsResult.error || goalsResult.error) {
    return {
      projects: [],
      goals: [],
      errorMessage: "Create options are unavailable right now.",
    };
  }

  return {
    projects: projectsResult.data ?? [],
    goals: goalsResult.data ?? [],
    errorMessage: null,
  };
}
