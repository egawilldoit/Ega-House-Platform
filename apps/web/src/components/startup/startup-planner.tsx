import Link from "next/link";
import { CircleAlert, Pin, Play, Target } from "lucide-react";

import {
  addStartupShortlistToTodayAction,
  addStartupTaskToTodayAction,
} from "@/app/startup/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CompactStat } from "@/components/ui/metric";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatIsoDate } from "@/lib/review-week";
import type { StartupPlannerData, StartupPlannerTask } from "@/lib/services/startup-planner-service";
import { isTaskCompletedStatus } from "@/lib/task-domain";
import { formatTaskToken } from "@/lib/task-domain";

import { getStartupPlannerSectionState } from "./startup-planner-sections";

function getTaskHref(task: StartupPlannerTask) {
  if (task.projectSlug) {
    return `/tasks/projects/${task.projectSlug}#task-${task.id}`;
  }

  return `/tasks#task-${task.id}`;
}

function PlannerTaskRow({ task, returnTo }: { task: StartupPlannerTask; returnTo: string }) {
  return (
    <li className="row">
      <div className="row-main">
        <span className="row-title">{task.title}</span>
        <span className="row-meta">
          {task.projectName}
          {task.goalTitle ? ` · ${task.goalTitle}` : ""}
          {task.dueDate ? ` · due ${formatIsoDate(task.dueDate)}` : ""}
        </span>
        {task.status === "blocked" && task.blockedReason ? (
          <span className="row-meta text-[color:var(--status-overdue)]">
            Blocked: {task.blockedReason}
          </span>
        ) : null}
      </div>

      <div className="row-actions flex-wrap justify-end">
        <StatusBadge status={task.status} />
        {task.focusRank ? <Badge tone="info">Pinned #{task.focusRank}</Badge> : null}
        {task.isPlannedForToday ? <Badge tone="active">In Today</Badge> : null}

        {task.isPlannedForToday ? null : (
          <form action={addStartupTaskToTodayAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="sm">
              Add to Today
            </Button>
          </form>
        )}

        <Link
          href={getTaskHref(task)}
          className="btn-instrument btn-instrument-muted inline-flex h-7 items-center px-2.5 text-xs"
        >
          Open
        </Link>
      </div>
    </li>
  );
}

function TaskPanel({
  title,
  description,
  tasks,
  returnTo,
  emptyTitle,
  emptyDescription,
  emptyIcon,
}: {
  title: string;
  description: string;
  tasks: StartupPlannerTask[];
  returnTo: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon: typeof CircleAlert;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Badge tone="muted">{tasks.length}</Badge>
        </div>
      </CardHeader>
      {tasks.length > 0 ? (
        <ul className="rows">
          {tasks.map((task) => (
            <PlannerTaskRow key={task.id} task={task} returnTo={returnTo} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
      )}
    </Card>
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
    .filter((task) => !task.isPlannedForToday && !isTaskCompletedStatus(task.status))
    .slice(0, 4)
    .map((task) => task.id)
    .join(",");

  return (
    <div className="flex flex-col gap-8">
      <DashboardSection
        title="Attention"
        description="Blocked and due-soon work to clear or consciously carry into the week."
      >
        <div className="workspace-main-rail-grid">
          <TaskPanel
            title="Carry-forward blockers"
            description="Blocked work that cannot move without a decision."
            tasks={data.blockersCarryForward}
            returnTo={returnTo}
            emptyTitle="No blocked carry-forward tasks"
            emptyDescription="Nothing is blocked right now. Move on to priorities."
            emptyIcon={CircleAlert}
          />
          <TaskPanel
            title="Due soon"
            description="Commitments landing inside this week window."
            tasks={data.dueSoonTasks.slice(0, 5)}
            returnTo={returnTo}
            emptyTitle="No due-soon tasks"
            emptyDescription="No due-soon tasks in this week window."
            emptyIcon={CircleAlert}
          />
        </div>
      </DashboardSection>

      <DashboardSection
        title="Priorities"
        description="Lock the week's goals and the shortlist that will lead execution."
      >
        <div className="workspace-main-rail-grid">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Key goals this week</CardTitle>
                    <CardDescription>Outcomes that should shape the next five days.</CardDescription>
                  </div>
                  <Badge tone="muted">{sectionState.goalsCount}</Badge>
                </div>
              </CardHeader>
              {data.keyGoals.length > 0 ? (
                <ul className="rows">
                  {data.keyGoals.map((goal) => (
                    <li key={goal.id} className="row">
                      <div className="row-main">
                        <span className="row-title">{goal.title}</span>
                        <span className="row-meta">
                          {goal.projectName ?? "No project"} · {goal.linkedOpenTaskCount} open task
                          {goal.linkedOpenTaskCount === 1 ? "" : "s"}
                        </span>
                        {goal.nextStep?.trim() ? (
                          <span className="row-meta">Next: {goal.nextStep.trim()}</span>
                        ) : null}
                      </div>
                      <div className="row-actions flex-wrap justify-end">
                        <Badge tone="muted">{formatTaskToken(goal.status)}</Badge>
                        <Link
                          href={`/goals?goal=${goal.id}`}
                          className="btn-instrument btn-instrument-muted inline-flex h-7 items-center px-2.5 text-xs"
                        >
                          Open goal
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={Target}
                  title="No active goals found"
                  description="Create or activate a goal to give this week a target."
                />
              )}
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Plan candidates</CardTitle>
                    <CardDescription>
                      Up to four tasks to push into Today as the week shortlist.
                    </CardDescription>
                  </div>
                  <Badge tone="muted">{sectionState.planThisWeekCount}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <form action={addStartupShortlistToTodayAction}>
                  <input type="hidden" name="taskIds" value={shortlistIds} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <Button type="submit" size="sm" disabled={!shortlistIds}>
                    Push shortlist to Today
                  </Button>
                </form>
                <Link
                  href="/today"
                  className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs"
                >
                  Open Today
                </Link>
              </CardContent>
            </Card>
          </div>

          <div className="workspace-secondary-rail">
            <Card>
              <CardHeader>
                <CardTitle>Weekly context</CardTitle>
                <CardDescription>
                  {formatIsoDate(data.week.weekStart)} - {formatIsoDate(data.week.weekEnd)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
                  {reviewSource?.summary?.trim() || "No weekly review yet. Use this startup pass to lock in the week priorities and move directly into Today."}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={sectionState.hasLatestReview ? "info" : "warn"}>
                    {sectionState.hasLatestReview ? "Review context loaded" : "No review context"}
                  </Badge>
                </div>
                <Link
                  href={`/review?weekOf=${data.week.previousWeekStart}`}
                  className="btn-instrument btn-instrument-muted inline-flex h-8 w-fit items-center px-3 text-xs"
                >
                  Open last review
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </DashboardSection>

      <DashboardSection
        title="Focus decision"
        description="Choose the pinned work that leads the week before opening Today."
      >
        <TaskPanel
          title="Focus / pinned work"
          description="Pinned tasks are the week's declared first moves."
          tasks={data.focusTasks.slice(0, 5)}
          returnTo={returnTo}
          emptyTitle="No pinned focus tasks"
          emptyDescription="Pin work from Tasks to declare the week's focus."
          emptyIcon={Pin}
        />
      </DashboardSection>

      <DashboardSection
        title="Start day"
        description="Hand the shortlist to Today and begin execution."
      >
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
              <CompactStat label="Planned" value={data.todaySummary.plannedCount} />
              <CompactStat label="In progress" value={data.todaySummary.inProgressCount} />
              <CompactStat label="Blocked" value={data.todaySummary.blockedCount} />
            </div>
            <p className="max-w-[80ch] text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
              Weekly startup should end in a concrete Today lane. Push a shortlist, then execute from the Today workspace.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/today" className="btn-instrument inline-flex h-8 items-center gap-2 px-3 text-sm">
                <Play className="h-4 w-4" aria-hidden="true" />
                Continue in Today
              </Link>
            </div>
          </CardContent>
        </Card>
      </DashboardSection>
    </div>
  );
}
