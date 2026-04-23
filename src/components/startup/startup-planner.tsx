import Link from "next/link";

import {
  addStartupShortlistToTodayAction,
  addStartupTaskToTodayAction,
} from "@/app/startup/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIsoDate } from "@/lib/review-week";
import type { StartupPlannerData, StartupPlannerTask } from "@/lib/services/startup-planner-service";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";

import { getStartupPlannerSectionState } from "./startup-planner-sections";

function getTaskHref(task: StartupPlannerTask) {
  if (task.projectSlug) {
    return `/tasks/projects/${task.projectSlug}#task-${task.id}`;
  }

  return `/tasks#task-${task.id}`;
}

function PlannerTaskCard({ task, returnTo }: { task: StartupPlannerTask; returnTo: string }) {
  return (
    <article className="rounded-[0.9rem] border border-[var(--border)] bg-[color:var(--instrument)] px-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[color:var(--foreground)]">{task.title}</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          {task.projectName}
          {task.goalTitle ? ` · ${task.goalTitle}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={getTaskStatusTone(task.status)}>{formatTaskToken(task.status)}</Badge>
          {task.dueDate ? <Badge tone="muted">Due {formatIsoDate(task.dueDate)}</Badge> : null}
          {task.focusRank ? <Badge tone="info">Pinned #{task.focusRank}</Badge> : null}
          {task.isPlannedForToday ? <Badge tone="success">In Today</Badge> : null}
        </div>
        {task.status === "blocked" && task.blockedReason ? (
          <p className="mt-2 text-sm leading-6 text-[var(--signal-error)]">
            Blocked: {task.blockedReason}
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {task.isPlannedForToday ? null : (
          <form action={addStartupTaskToTodayAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="sm" variant="default">
              Add to Today
            </Button>
          </form>
        )}

        <Link href={getTaskHref(task)} className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-xs">
          Open
        </Link>
      </div>
    </article>
  );
}

export function StartupPlanner({
  data,
  returnTo,
}: {
  data: StartupPlannerData;
  returnTo: string;
}) {
  const sectionState = getStartupPlannerSectionState(data);
  const reviewSource = data.review.currentWeek ?? data.review.latest;
  const shortlistIds = data.planThisWeekTasks
    .filter((task) => !task.isPlannedForToday && task.status !== "done")
    .slice(0, 4)
    .map((task) => task.id)
    .join(",");

  return (
    <div className="space-y-6">
      <Card className="border-[var(--border)] bg-white">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="glass-label text-etch">Weekly context</p>
              <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                {formatIsoDate(data.week.weekStart)} - {formatIsoDate(data.week.weekEnd)}
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--muted-foreground)]">
                {reviewSource?.summary?.trim() || "No weekly review yet. Use this startup pass to lock in the week priorities and move directly into Today."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={sectionState.hasLatestReview ? "info" : "warn"}>
                {sectionState.hasLatestReview ? "Review context loaded" : "No review context"}
              </Badge>
              <Badge tone="muted">{sectionState.planThisWeekCount} plan candidates</Badge>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <form action={addStartupShortlistToTodayAction}>
              <input type="hidden" name="taskIds" value={shortlistIds} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" size="sm" variant="default" disabled={!shortlistIds}>
                Push shortlist to Today
              </Button>
            </form>
            <Link href="/today" className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-xs">
              Open Today
            </Link>
            <Link href={`/review?weekOf=${data.week.previousWeekStart}`} className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-xs">
              Open last review
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
        <div className="space-y-6">
          <Card className="border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-xl">Carry-forward blockers</CardTitle>
                <Badge tone={sectionState.blockersCount > 0 ? "warn" : "muted"}>
                  {sectionState.blockersCount}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {data.blockersCarryForward.length > 0 ? (
                data.blockersCarryForward.map((task) => (
                  <PlannerTaskCard key={task.id} task={task} returnTo={returnTo} />
                ))
              ) : (
                <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  No blocked carry-forward tasks right now.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-xl">Key goals this week</CardTitle>
                <Badge tone="muted">{sectionState.goalsCount}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {data.keyGoals.length > 0 ? (
                data.keyGoals.map((goal) => (
                  <article
                    key={goal.id}
                    className="rounded-[0.9rem] border border-[var(--border)] bg-[color:var(--instrument)] px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[color:var(--foreground)]">{goal.title}</p>
                      <Badge tone="muted">{formatTaskToken(goal.status)}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                      {goal.projectName ?? "No project"} · {goal.linkedOpenTaskCount} open task
                      {goal.linkedOpenTaskCount === 1 ? "" : "s"}
                    </p>
                    {goal.nextStep?.trim() ? (
                      <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                        Next: {goal.nextStep.trim()}
                      </p>
                    ) : null}
                    <div className="mt-3">
                      <Link href={`/goals?goal=${goal.id}`} className="glass-label text-signal-live">
                        Open goal
                      </Link>
                    </div>
                  </article>
                ))
              ) : (
                <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  No active goals found for weekly planning context.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-xl">Focus / pinned work</CardTitle>
                <Badge tone="muted">{sectionState.focusCount}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {data.focusTasks.length > 0 ? (
                data.focusTasks.slice(0, 5).map((task) => (
                  <PlannerTaskCard key={task.id} task={task} returnTo={returnTo} />
                ))
              ) : (
                <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  No pinned focus tasks yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-xl">Due soon</CardTitle>
                <Badge tone={sectionState.dueSoonCount > 0 ? "warn" : "muted"}>
                  {sectionState.dueSoonCount}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {data.dueSoonTasks.length > 0 ? (
                data.dueSoonTasks.slice(0, 5).map((task) => (
                  <PlannerTaskCard key={task.id} task={task} returnTo={returnTo} />
                ))
              ) : (
                <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  No due-soon tasks in this week window.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-[var(--border)] bg-white">
            <CardContent className="space-y-3 px-5 pb-5 pt-5">
              <p className="glass-label text-etch">Today handoff</p>
              <div className="flex flex-wrap gap-2">
                <Badge tone="muted">{data.todaySummary.plannedCount} planned</Badge>
                <Badge tone="info">{data.todaySummary.inProgressCount} in progress</Badge>
                <Badge tone={data.todaySummary.blockedCount > 0 ? "warn" : "muted"}>
                  {data.todaySummary.blockedCount} blocked
                </Badge>
              </div>
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                Weekly startup should end in a concrete Today lane. Push a shortlist, then execute from the Today workspace.
              </p>
              <Link href="/today" className="btn-instrument inline-flex h-8 items-center px-3 text-xs">
                Continue in Today
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
