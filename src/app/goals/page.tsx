import type { Metadata } from "next";
import Link from "next/link";

import { InlineGoalHealthForm } from "@/components/goals/inline-goal-health-form";
import { AppShell } from "@/components/layout/app-shell";
import { InlineGoalNextStepForm } from "@/components/goals/inline-goal-next-step-form";
import { InlineGoalStatusForm } from "@/components/goals/inline-goal-status-form";
import { Badge } from "@/components/ui/badge";
import {
  getGoalHealthLabel,
  getGoalHealthTone,
  toGoalHealthOrNull,
} from "@/lib/goal-health";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getGoalNextStepPreview } from "@/lib/goal-next-step";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";

import {
  updateGoalHealthAction,
  updateGoalNextStepAction,
  updateGoalStatusAction,
} from "./actions";
import { CreateGoalForm } from "./create-goal-form";

export const metadata: Metadata = {
  title: "Goals | EGA House",
  description: "Goals list and creation flow.",
};

type GoalsPageProps = {
  searchParams: Promise<{
    goal?: string;
    goalUpdateError?: string;
    goalUpdateGoalId?: string;
    goalUpdateField?: string;
  }>;
};

type GoalTaskRow = {
  id: string;
  title: string;
  status: string;
};

type GoalView = {
  id: string;
  title: string;
  description: string | null;
  nextStep: string | null;
  health: string | null;
  status: string;
  updatedAt: string;
  projectName: string | null;
  linkedTasks: GoalTaskRow[];
  progressPercent: number;
};

async function getGoalsData() {
  const supabase = await createClient();
  const [projectsResult, goalsResult, tasksResult] = await Promise.all([
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    supabase
      .from("goals")
      .select("id, title, description, next_step, health, status, updated_at, projects(name)")
      .order("updated_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id, title, status, goal_id")
      .not("goal_id", "is", null)
      .order("updated_at", { ascending: false }),
  ]);
  if (projectsResult.error) {
    throw new Error(`Failed to load projects: ${projectsResult.error.message}`);
  }
  if (goalsResult.error) {
    throw new Error(`Failed to load goals: ${goalsResult.error.message}`);
  }
  if (tasksResult.error) {
    throw new Error(`Failed to load goal tasks: ${tasksResult.error.message}`);
  }

  const tasksByGoal = new Map<string, GoalTaskRow[]>();
  for (const task of tasksResult.data) {
    if (!task.goal_id) {
      continue;
    }
    const bucket = tasksByGoal.get(task.goal_id) ?? [];
    bucket.push({ id: task.id, title: task.title, status: task.status });
    tasksByGoal.set(task.goal_id, bucket);
  }

  const goals = goalsResult.data.map((goal) => {
    const linkedTasks = tasksByGoal.get(goal.id) ?? [];
    const completedTasks = linkedTasks.filter((task) => task.status === "done").length;
    const progressPercent =
      linkedTasks.length > 0 ? Math.round((completedTasks / linkedTasks.length) * 100) : 0;

    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      nextStep: goal.next_step,
      health: goal.health,
      status: goal.status,
      updatedAt: goal.updated_at,
      projectName: goal.projects?.name ?? null,
      linkedTasks,
      progressPercent,
    } satisfies GoalView;
  });

  return { projects: projectsResult.data, goals };
}

function MetricCard({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <Card className="border-[var(--border)] bg-white">
      <CardHeader className="pb-3">
        <span className="glass-label text-etch">{label}</span>
      </CardHeader>
      <CardContent className="pt-0">
        <div
          className={`text-3xl font-semibold tracking-tight ${
            accent ? "text-signal-live" : "text-[color:var(--foreground)]"
          }`}
        >
          {value}
        </div>
        <div
          className={`mt-2 text-sm ${
            accent ? "text-signal-live" : "text-[color:var(--muted-foreground)]"
          }`}
        >
          {detail}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function GoalsPage({ searchParams }: GoalsPageProps) {
  const resolvedSearchParams = await searchParams;
  const goalUpdateError = resolvedSearchParams.goalUpdateError?.slice(0, 180) ?? null;
  const goalUpdateGoalId = resolvedSearchParams.goalUpdateGoalId ?? null;
  const goalUpdateField = resolvedSearchParams.goalUpdateField ?? null;
  const { projects, goals } = await getGoalsData();
  const focusedGoal =
    goals.find((goal) => goal.id === resolvedSearchParams.goal) ?? goals[0] ?? null;
  const focusedGoalHealth = focusedGoal ? toGoalHealthOrNull(focusedGoal.health) : null;
  const linkedTasks = focusedGoal?.linkedTasks ?? [];
  const activeGoalCount = goals.filter((goal) => goal.status === "active").length;
  const completedGoalCount = goals.filter((goal) => goal.status === "done").length;

  return (
    <AppShell
      eyebrow="Strategic Tracking"
      title={focusedGoal?.title ?? "Goals"}
      description={
        focusedGoal?.description?.trim() || "Track strategic goals attached to projects."
      }
    >
      {focusedGoal ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(19rem,0.82fr)_minmax(0,1.18fr)]">
          <div className="space-y-6">
            <Card className="border-[var(--border)] bg-[color:var(--instrument)]">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                  <span>{focusedGoal.projectName ?? "Unassigned project"}</span>
                  <span>/</span>
                  <span className="text-signal-live">Active Goal</span>
                </div>
                <CardTitle className="text-xl">Goal overview</CardTitle>
                <CardDescription>
                  Progress, recency, and workspace signal for the selected objective.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="glass-label text-etch">Overall Progress</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--foreground)]">
                      {focusedGoal.progressPercent}%
                    </p>
                  </div>
                  <p className="text-sm text-[color:var(--muted-foreground)]">
                    Updated {new Date(focusedGoal.updatedAt).toLocaleDateString("en-US")}
                  </p>
                </div>
                <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-[color:var(--instrument-raised)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--signal-live)] to-[rgba(34,197,94,0.45)]"
                    style={{ width: `${focusedGoal.progressPercent}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
              <MetricCard
                label="Linked Tasks"
                value={linkedTasks.length.toString()}
                detail={
                  linkedTasks.length > 0
                    ? `${linkedTasks.filter((task) => task.status === "done").length} completed`
                    : "No linked tasks yet"
                }
              />
              <MetricCard
                label="Active Goals"
                value={activeGoalCount.toString()}
                detail={`${goals.length} goals in workspace`}
                accent
              />
            </div>

            <Card className="border-[var(--border)] bg-white">
              <CardHeader className="pb-4">
                <p className="glass-label text-signal-live">Current Status</p>
                <CardTitle className="text-xl">Delivery posture</CardTitle>
                <CardDescription>
                  Update the active goal without leaving the detail screen.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={getTaskStatusTone(focusedGoal.status)}>
                    {formatTaskToken(focusedGoal.status)}
                  </Badge>
                  {focusedGoalHealth ? (
                    <Badge tone={getGoalHealthTone(focusedGoalHealth)}>
                      {getGoalHealthLabel(focusedGoalHealth)}
                    </Badge>
                  ) : (
                    <Badge tone="muted">Health not set</Badge>
                  )}
                  <Badge tone="muted">{completedGoalCount} completed overall</Badge>
                </div>
                <p className="mt-3 text-sm text-[color:var(--muted-foreground)]">
                  Last updated {new Date(focusedGoal.updatedAt).toLocaleString("en-US")}
                </p>
                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <InlineGoalStatusForm
                    action={updateGoalStatusAction}
                    goalId={focusedGoal.id}
                    returnTo={`/goals?goal=${focusedGoal.id}`}
                    defaultStatus={focusedGoal.status}
                    error={
                      goalUpdateGoalId === focusedGoal.id && goalUpdateField === "status"
                        ? goalUpdateError
                        : null
                    }
                  />
                </div>
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <InlineGoalHealthForm
                    action={updateGoalHealthAction}
                    goalId={focusedGoal.id}
                    returnTo={`/goals?goal=${focusedGoal.id}`}
                    defaultHealth={focusedGoal.health}
                    error={
                      goalUpdateGoalId === focusedGoal.id && goalUpdateField === "health"
                        ? goalUpdateError
                        : null
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-[var(--border)] bg-white">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="glass-label text-etch">Goal Directory</p>
                    <CardTitle className="mt-2 text-xl">Workspace goals</CardTitle>
                    <CardDescription>
                      Move between current goals without losing the surrounding context.
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Badge tone="muted">{goals.length} total</Badge>
                  </CardAction>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {goals.map((goal) => {
                  const isActiveGoal = goal.id === focusedGoal.id;
                  const nextStepPreview = getGoalNextStepPreview(goal.nextStep, 70);
                  const goalHealth = toGoalHealthOrNull(goal.health);

                  return (
                    <Link
                      key={goal.id}
                      href={`/goals?goal=${goal.id}`}
                      className={`flex items-center justify-between gap-3 rounded-[1rem] border px-4 py-3 transition ${
                        isActiveGoal
                          ? "border-[rgba(23,123,82,0.16)] bg-[rgba(23,123,82,0.05)]"
                          : "border-transparent bg-[color:var(--instrument)] hover:border-[var(--border)] hover:bg-[color:var(--instrument-raised)]"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[color:var(--foreground)]">
                          {goal.title}
                        </p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                          {goal.projectName ?? "Unassigned"} · {goal.progressPercent}% progress
                        </p>
                        {nextStepPreview ? (
                          <p className="mt-1 truncate text-xs text-[color:var(--muted-foreground)]">
                            Next: {nextStepPreview}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={getTaskStatusTone(goal.status)}>
                          {formatTaskToken(goal.status)}
                        </Badge>
                        {goalHealth ? (
                          <Badge tone={getGoalHealthTone(goalHealth)}>
                            {getGoalHealthLabel(goalHealth)}
                          </Badge>
                        ) : null}
                      </div>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="border-[var(--border)] bg-white">
              <CardHeader className="pb-4">
                <p className="glass-label text-signal-live">Create Goal</p>
                <CardTitle className="text-xl">Add another objective</CardTitle>
                <CardDescription>
                  Keep strategic planning close to the current detail view.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {projects.length === 0 ? (
                  <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    Create a project first to attach a goal to the workspace.
                  </div>
                ) : (
                  <CreateGoalForm projects={projects} />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-[var(--border)] bg-white">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="glass-label text-signal-live">Goal Detail</p>
                    <CardTitle className="mt-2 text-2xl">{focusedGoal.title}</CardTitle>
                    <CardDescription>
                      Outcome framing and narrative guidance for the selected objective.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={getTaskStatusTone(focusedGoal.status)}>
                      {formatTaskToken(focusedGoal.status)}
                    </Badge>
                    {focusedGoalHealth ? (
                      <Badge tone={getGoalHealthTone(focusedGoalHealth)}>
                        {getGoalHealthLabel(focusedGoalHealth)}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm leading-7 text-[color:var(--muted-foreground)]">
                  {focusedGoal.description?.trim() ||
                    "This goal does not have an extended description yet. Use the initiatives below to drive visible progress."}
                </p>
                {focusedGoal.nextStep?.trim() ? (
                  <p className="mt-4 text-sm text-[color:var(--foreground)]">
                    <span className="glass-label text-signal-live">Next step</span>{" "}
                    {focusedGoal.nextStep.trim()}
                  </p>
                ) : null}
                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <InlineGoalNextStepForm
                    action={updateGoalNextStepAction}
                    goalId={focusedGoal.id}
                    returnTo={`/goals?goal=${focusedGoal.id}`}
                    defaultNextStep={focusedGoal.nextStep}
                    error={
                      goalUpdateGoalId === focusedGoal.id && goalUpdateField === "next_step"
                        ? goalUpdateError
                        : null
                    }
                  />
                </div>
              </CardContent>
              <CardFooter className="justify-between">
                <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                  {focusedGoal.projectName ?? "No project"} owner context
                </p>
                <Link href="/tasks" className="glass-label text-signal-live">
                  Browse tasks
                </Link>
              </CardFooter>
            </Card>

            <Card className="border-[var(--border)] bg-white">
              <CardHeader className="border-b border-[var(--border)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="glass-label text-signal-live">Linked Initiatives</p>
                    <CardTitle className="mt-2 text-xl">Execution attached to this goal</CardTitle>
                    <CardDescription>
                      {linkedTasks.length > 0
                        ? `${linkedTasks.length} task${linkedTasks.length === 1 ? "" : "s"} tied to this outcome`
                        : "Attach tasks to this goal to turn strategy into execution."}
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Link href="/tasks" className="glass-label text-signal-live">
                      View All
                    </Link>
                  </CardAction>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 p-4">
                {linkedTasks.length > 0 ? (
                  linkedTasks.map((task) => (
                    <Link
                      key={task.id}
                      href={`/tasks?goal=${focusedGoal.id}#task-${task.id}`}
                      className="group flex items-center justify-between rounded-[1rem] border border-transparent px-4 py-3 transition hover:border-[var(--border)] hover:bg-[color:var(--instrument-raised)]"
                    >
                      <div className="flex items-center space-x-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(34,197,94,0.08)] text-[var(--signal-live)]">
                          <span className="text-sm font-semibold">
                            {task.title.slice(0, 1).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-[color:var(--foreground)]">
                            {task.title}
                          </div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                            {focusedGoal.projectName ?? "Project"} • {formatTaskToken(task.status)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {task.status === "done" ? (
                          <Badge tone="success">Completed</Badge>
                        ) : (
                          <Badge tone={getTaskStatusTone(task.status)}>
                            {formatTaskToken(task.status)}
                          </Badge>
                        )}
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    No linked initiatives are attached to this goal yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
          <Card className="self-start border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <Badge tone="info" className="w-fit">
                Goals
              </Badge>
              <CardTitle className="text-2xl">No goals yet</CardTitle>
              <CardDescription className="max-w-2xl">
                Create a project goal to start tracking progress against a defined outcome.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="surface-empty px-5 py-5 text-sm leading-6 text-[color:var(--muted-foreground)]">
                The detail view will populate once the first strategic goal exists in the workspace.
              </div>
            </CardContent>
          </Card>

          <Card className="self-start border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <p className="glass-label text-signal-live">Create Goal</p>
              <CardTitle className="text-xl">Start the first objective</CardTitle>
              <CardDescription>
                Add a new strategic goal to an existing project.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {projects.length === 0 ? (
                <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  Create a project first to attach a goal to the workspace.
                </div>
              ) : (
                <CreateGoalForm projects={projects} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
