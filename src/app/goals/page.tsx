import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { InlineGoalStatusForm } from "@/components/goals/inline-goal-status-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";

import { updateGoalStatusAction } from "./actions";
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
      .select("id, title, description, status, updated_at, projects(name)")
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
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <span className="glass-label text-etch">{label}</span>
        </div>
        <div
          className={`mt-4 text-3xl font-semibold tracking-tight ${
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
  const { projects, goals } = await getGoalsData();
  const focusedGoal =
    goals.find((goal) => goal.id === resolvedSearchParams.goal) ?? goals[0] ?? null;
  const linkedTasks = focusedGoal?.linkedTasks ?? [];
  const activeGoalCount = goals.filter((goal) => goal.status === "active").length;

  return (
    <AppShell
      eyebrow="Strategic Tracking"
      title={focusedGoal?.title ?? "Goals"}
      description={
        focusedGoal?.description?.trim() || "Track strategic goals attached to projects."
      }
    >
      {focusedGoal ? (
        <>
          <div className="mb-8 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
            <span>{focusedGoal.projectName ?? "Unassigned project"}</span>
            <span>/</span>
            <span className="text-signal-live">Active Goal</span>
          </div>

          <div className="mb-8 max-w-4xl rounded-sm border border-[var(--border)] bg-[color:var(--instrument)] p-6">
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
          </div>

          <div className="grid gap-8 lg:grid-cols-3">
            <div className="space-y-6">
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
              <Card className="border-[var(--border)] bg-white">
                <CardContent className="p-6">
                  <span className="glass-label text-signal-live">Current Status</span>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge tone={getTaskStatusTone(focusedGoal.status)}>
                      {formatTaskToken(focusedGoal.status)}
                    </Badge>
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
                      error={goalUpdateGoalId === focusedGoal.id ? goalUpdateError : null}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-2">
              <Card className="h-full border-[var(--border)] bg-white">
                <CardContent className="flex h-full flex-col overflow-hidden p-0">
                  <div className="flex items-center justify-between border-b border-[var(--border)] p-6">
                    <h2 className="text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
                      Linked Initiatives
                    </h2>
                    <Link href="/tasks" className="glass-label text-signal-live">
                      View All
                    </Link>
                  </div>
                  <div className="flex-1 space-y-2 p-4">
                    {linkedTasks.length > 0 ? (
                      linkedTasks.map((task) => (
                        <Link
                          key={task.id}
                          href={`/tasks?goal=${focusedGoal.id}#task-${task.id}`}
                          className="group flex items-center justify-between rounded-sm border border-transparent px-4 py-4 transition hover:border-[var(--border)] hover:bg-[color:var(--instrument-raised)]"
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
                      <div className="surface-empty px-4 py-5 text-sm leading-7 text-[color:var(--muted-foreground)]">
                        No linked initiatives are attached to this goal yet.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : (
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="space-y-5 p-8">
            <Badge tone="info" className="w-fit">
              Goals
            </Badge>
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
                No goals yet
              </h2>
              <p className="max-w-2xl text-sm leading-7 text-[color:var(--muted-foreground)]">
                Create a project goal to start tracking progress against a defined outcome.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-8 max-w-sm">
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
              Create Goal
            </h3>
            <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
              Add a new strategic goal to an existing project.
            </p>
            <div className="mt-5">
              {projects.length === 0 ? (
                <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  Create a project first to attach a goal to the workspace.
                </div>
              ) : (
                <CreateGoalForm projects={projects} />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
