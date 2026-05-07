import { getWeekWindow } from "@/lib/review-week";
import {
  calculateExecutionEvidenceForWindow,
  type ExecutionEvidenceTimeBucket,
} from "@/lib/services/execution-evidence-service";
import {
  generateWeeklyReviewDraft,
  type WeeklyReviewDraftInput,
  type WeeklyReviewTaskActivity,
  type WeeklyReviewTimeBucket,
} from "@/lib/weekly-review-generator";

type ReviewDraftSupabaseClient = {
  from(table: string): unknown;
};

type ReviewDraftQuery = {
  select(columns: string): ReviewDraftQuery;
  eq(column: string, value: string): ReviewDraftQuery;
  neq(column: string, value: string): ReviewDraftQuery;
  is(column: string, value: null): ReviewDraftQuery;
  lt(column: string, value: string): ReviewDraftQuery;
  gte(column: string, value: string): ReviewDraftQuery;
  or(expression: string): ReviewDraftQuery;
  order(column: string, options?: { ascending?: boolean }): ReviewDraftQuery;
  limit(count: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  maybeSingle(): PromiseLike<{ data: Record<string, string | null> | null; error: { message: string } | null }>;
};

type ReviewTaskRow = {
  id: string;
  title: string;
  status: string;
  blocked_reason: string | null;
  estimate_minutes: number | null;
  completed_at: string | null;
  updated_at: string;
  projects: { name: string } | null;
  goals: { title: string } | null;
};

type ReviewSessionRow = {
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tasks:
    | {
        id: string;
        title: string;
        projects: { id: string; name: string } | null;
        goals: { id: string; title: string } | null;
      }
    | null;
};

function queryFrom(supabase: ReviewDraftSupabaseClient, table: string) {
  return supabase.from(table) as ReviewDraftQuery;
}

function mapTaskActivity(
  task: ReviewTaskRow,
  trackedSecondsByTask: Map<string, number>,
): WeeklyReviewTaskActivity {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    blockedReason: task.blocked_reason,
    estimateMinutes: task.estimate_minutes,
    completedAt: task.completed_at,
    updatedAt: task.updated_at,
    projectName: task.projects?.name ?? null,
    goalTitle: task.goals?.title ?? null,
    trackedSeconds: trackedSecondsByTask.get(task.id) ?? 0,
  };
}

function mapTimeBuckets(
  buckets: ExecutionEvidenceTimeBucket[],
): WeeklyReviewTimeBucket[] {
  return buckets.map((bucket) => ({
    id: bucket.id,
    label: bucket.label,
    trackedSeconds: bucket.trackedSeconds,
    sessionCount: bucket.sessionCount,
  }));
}

async function getPreviousWeekReview(
  supabase: ReviewDraftSupabaseClient,
  weekStart: string,
  ownerUserId: string,
): Promise<WeeklyReviewDraftInput["previousReview"]> {
  const { data, error } = await queryFrom(supabase, "week_reviews")
    .select("week_start, week_end, summary, next_steps")
    .eq("owner_user_id", ownerUserId)
    .lt("week_start", weekStart)
    .order("week_start", { ascending: false })
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load previous review context: ${error.message}`);
  }

  return data
    ? {
        weekStart: String(data.week_start),
        weekEnd: String(data.week_end),
        summary: data.summary,
        nextSteps: data.next_steps,
      }
    : null;
}

export async function generateWeeklyReviewDraftForUser({
  supabase,
  ownerUserId,
  weekStart,
  weekEnd,
  now = new Date(),
}: {
  supabase: ReviewDraftSupabaseClient;
  ownerUserId: string;
  weekStart: string;
  weekEnd: string;
  now?: Date;
}) {
  const { startIso, endExclusiveIso } = getWeekWindow(weekStart, weekEnd);
  const [completedResult, carriedResult, blockedResult, sessionsResult, goalsResult, previousReview] =
    await Promise.all([
      queryFrom(supabase, "tasks")
        .select(
          "id, title, status, blocked_reason, estimate_minutes, completed_at, updated_at, projects(name), goals(title)",
        )
        .eq("owner_user_id", ownerUserId)
        .eq("status", "done")
        .lt("updated_at", endExclusiveIso)
        .or(`completed_at.gte.${startIso},updated_at.gte.${startIso}`)
        .order("updated_at", { ascending: false })
        .limit(80),
      queryFrom(supabase, "tasks")
        .select(
          "id, title, status, blocked_reason, estimate_minutes, completed_at, updated_at, projects(name), goals(title)",
        )
        .eq("owner_user_id", ownerUserId)
        .is("archived_at", null)
        .neq("status", "done")
        .lt("created_at", endExclusiveIso)
        .order("updated_at", { ascending: false })
        .limit(120),
      queryFrom(supabase, "tasks")
        .select(
          "id, title, status, blocked_reason, estimate_minutes, completed_at, updated_at, projects(name), goals(title)",
        )
        .eq("owner_user_id", ownerUserId)
        .is("archived_at", null)
        .eq("status", "blocked")
        .order("updated_at", { ascending: false })
        .limit(80),
      queryFrom(supabase, "task_sessions")
        .select(
          "task_id, started_at, ended_at, duration_seconds, tasks(id, title, projects(id, name), goals(id, title))",
        )
        .eq("owner_user_id", ownerUserId)
        .lt("started_at", endExclusiveIso)
        .or(`ended_at.is.null,ended_at.gte.${startIso}`)
        .order("started_at", { ascending: false })
        .limit(500),
      queryFrom(supabase, "goals")
        .select("title")
        .eq("owner_user_id", ownerUserId)
        .gte("updated_at", startIso)
        .lt("updated_at", endExclusiveIso)
        .limit(80),
      getPreviousWeekReview(supabase, weekStart, ownerUserId),
    ]);

  if (completedResult.error) {
    throw new Error(`Failed to load completed review tasks: ${completedResult.error.message}`);
  }
  if (carriedResult.error) {
    throw new Error(`Failed to load carried review tasks: ${carriedResult.error.message}`);
  }
  if (blockedResult.error) {
    throw new Error(`Failed to load blocked review tasks: ${blockedResult.error.message}`);
  }
  if (sessionsResult.error) {
    throw new Error(`Failed to load review session activity: ${sessionsResult.error.message}`);
  }
  if (goalsResult.error) {
    throw new Error(`Failed to load touched review goals: ${goalsResult.error.message}`);
  }

  const window = { startIso, endIso: endExclusiveIso };
  const nowIso = now.toISOString();
  const evidence = calculateExecutionEvidenceForWindow(
    (sessionsResult.data ?? []) as ReviewSessionRow[],
    window,
    { nowIso },
  );
  const touchedProjects = new Set(evidence.touchedProjectNames);
  const touchedGoals = new Set(evidence.touchedGoalTitles);

  const completedTasks = ((completedResult.data ?? []) as ReviewTaskRow[]).filter((task) =>
    task.completed_at
      ? task.completed_at >= startIso && task.completed_at < endExclusiveIso
      : task.updated_at >= startIso && task.updated_at < endExclusiveIso,
  );
  const carriedTasks = (carriedResult.data ?? []) as ReviewTaskRow[];
  const blockedTasks = (blockedResult.data ?? []) as ReviewTaskRow[];

  for (const task of [...completedTasks, ...carriedTasks, ...blockedTasks]) {
    if (task.projects?.name) {
      touchedProjects.add(task.projects.name);
    }
    if (task.goals?.title) {
      touchedGoals.add(task.goals.title);
    }
  }
  for (const goal of (goalsResult.data ?? []) as Array<{ title: string | null }>) {
    if (goal.title) {
      touchedGoals.add(goal.title);
    }
  }

  return generateWeeklyReviewDraft({
    weekStart,
    weekEnd,
    completedTasks: completedTasks.map((task) =>
      mapTaskActivity(task, evidence.trackedSecondsByTask),
    ),
    carriedTasks: carriedTasks.map((task) =>
      mapTaskActivity(task, evidence.trackedSecondsByTask),
    ),
    blockedTasks: blockedTasks.map((task) =>
      mapTaskActivity(task, evidence.trackedSecondsByTask),
    ),
    projectTime: mapTimeBuckets(evidence.projectTimeBuckets),
    taskTime: mapTimeBuckets(evidence.taskTimeBuckets),
    touchedProjects: Array.from(touchedProjects),
    touchedGoals: Array.from(touchedGoals),
    previousReview,
  });
}
