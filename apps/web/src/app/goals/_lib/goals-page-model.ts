import { createAuthenticatedActor, getGoalsReadModel } from "@ega/application";
import { SupabaseGoalsRepository } from "@ega/data-access";
import { normalizeGoalViewFilter, type GoalViewFilter } from "@/lib/goal-archive";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

export type GoalsSearchParams = {
  goal?: string;
  view?: string;
  goalUpdateError?: string;
  goalUpdateGoalId?: string;
  goalUpdateField?: string;
};

export async function getGoalsPageModel(searchParams: GoalsSearchParams) {
  const activeView = normalizeGoalViewFilter(searchParams.view);
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const repository = new SupabaseGoalsRepository(supabase);
  const result = await getGoalsReadModel(actor, repository, activeView);
  if (!result.ok) throw new Error(result.errorMessage);
  const { projects, goals, summary } = result.data;
  const focusedGoal = goals.find((g) => g.id === searchParams.goal) ?? goals[0] ?? null;
  return {
    activeView,
    projects,
    goals,
    summary,
    focusedGoal,
    goalUpdateError: searchParams.goalUpdateError?.slice(0, 180) ?? null,
    goalUpdateGoalId: searchParams.goalUpdateGoalId ?? null,
    goalUpdateField: searchParams.goalUpdateField ?? null,
  };
}

export type GoalsPageModel = Awaited<ReturnType<typeof getGoalsPageModel>>;
