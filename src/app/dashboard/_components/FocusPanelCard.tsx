import Link from "next/link";

import { AlertTriangle, Clock3, Target } from "lucide-react";

import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import { pinTaskAction, unpinTaskAction } from "@/app/tasks/actions";
import { startTimerAction, stopTimerAction } from "@/app/timer/actions";

import { RelativeTime } from "./RelativeTime";
import { getTaskContextHref } from "../_lib/dashboard-helpers";
import type { DashboardData } from "../_lib/dashboard-data";

interface FocusPanelCardProps {
  activeTimer: DashboardData["activeTimer"];
  focusPanel: DashboardData["focusPanel"];
}

function FocusPanelBody({
  activeTimer,
  activeTimerError,
  focusPanel,
  focusPanelError,
}: {
  activeTimer: DashboardData["activeTimer"]["data"];
  activeTimerError: string | null;
  focusPanel: DashboardData["focusPanel"]["data"];
  focusPanelError: string | null;
}) {
  if (activeTimer) {
    const activeTaskHref = getTaskContextHref(activeTimer.taskId, activeTimer.projectSlug);

    return (
      <div className="space-y-4">
        <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="active">Timer running</Badge>
            <Badge tone={getTaskStatusTone(activeTimer.taskStatus)}>
              {formatTaskToken(activeTimer.taskStatus)}
            </Badge>
            <Badge tone="muted">{formatTaskToken(activeTimer.taskPriority)}</Badge>
          </div>
          <p className="mt-3 text-sm font-semibold text-[color:var(--foreground)]">
            {activeTimer.taskTitle}
          </p>
          <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
            {activeTimer.projectName}
            {activeTimer.goalTitle ? ` · ${activeTimer.goalTitle}` : ""} · Started{" "}
            <RelativeTime isoString={activeTimer.startedAt} />
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone="active">{activeTimer.elapsedLabel}</Badge>
          <Link href={activeTaskHref} className="btn-instrument btn-instrument-muted">
            Open task
          </Link>
          <Link href="/timer" className="btn-instrument">
            Open timer
          </Link>
          <form action={stopTimerAction}>
            <input type="hidden" name="sessionId" value={activeTimer.sessionId} />
            <input type="hidden" name="returnTo" value="/dashboard" />
            <Button type="submit" variant="danger" size="sm">
              Stop timer
            </Button>
          </form>
        </div>
      </div>
    );
  }

  if (focusPanelError) {
    return <div className="feedback-block feedback-block-error">{focusPanelError}</div>;
  }

  if (!focusPanel) {
    return (
      <EmptyState
        icon={Clock3}
        title="Focus recommendation is warming up"
        description="The recommendation engine is collecting enough task context."
      />
    );
  }

  if (focusPanel.state === "blocked_only") {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={AlertTriangle}
          title="Only blocked work detected"
          description={`${focusPanel.blockedTaskCount} open task${
            focusPanel.blockedTaskCount === 1 ? " is" : "s are"
          } blocked. Unblock work or update status to resume execution.`}
        />
        <div className="flex flex-wrap gap-2">
          <Badge tone="danger">Blocked only</Badge>
          <Badge tone="muted">{focusPanel.openTaskCount} open</Badge>
          {focusPanel.pinnedTaskCount > 0 ? (
            <Badge tone="muted">{focusPanel.pinnedTaskCount} pinned</Badge>
          ) : null}
        </div>
        <Link href="/tasks" className="btn-instrument btn-instrument-muted">
          Open tasks
        </Link>
      </div>
    );
  }

  if (focusPanel.state === "empty") {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={Target}
          title="No actionable tasks yet"
          description="Capture a task or reopen a completed item to start focus time."
        />
        <div className="flex flex-wrap gap-2">
          <Link href="/tasks" className="btn-instrument btn-instrument-muted">
            Open tasks
          </Link>
          <Link href="/timer" className="btn-instrument btn-instrument-muted">
            Open timer
          </Link>
        </div>
      </div>
    );
  }

  const { recommendation } = focusPanel;
  const recommendedTask = recommendation.task;
  const recommendedTaskHref = getTaskContextHref(
    recommendedTask.id,
    recommendedTask.projectSlug,
  );

  return (
    <div className="space-y-4">
      <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="active">Recommended next</Badge>
          <Badge tone={getTaskStatusTone(recommendedTask.status)}>
            {formatTaskToken(recommendedTask.status)}
          </Badge>
          <Badge tone="muted">{formatTaskToken(recommendedTask.priority)}</Badge>
          <TaskDueDateLabel dueDate={recommendedTask.dueDate} status={recommendedTask.status} />
        </div>
        <p className="mt-3 text-sm font-semibold text-[color:var(--foreground)]">
          {recommendedTask.title}
        </p>
        <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
          {recommendedTask.projectName}
          {recommendedTask.goalTitle ? ` · ${recommendedTask.goalTitle}` : ""}
          {recommendedTask.estimateMinutes
            ? ` · Est. ${formatTaskEstimate(recommendedTask.estimateMinutes)}`
            : ""}
          {" · "}
          Updated <RelativeTime isoString={recommendedTask.updatedAt} />
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {recommendation.signals.slice(0, 4).map((signal) => (
          <Badge key={signal} tone="info">
            {signal}
          </Badge>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <form action={startTimerAction}>
          <input type="hidden" name="taskId" value={recommendedTask.id} />
          <input type="hidden" name="returnTo" value="/dashboard" />
          <Button type="submit" size="sm">
            Start focus timer
          </Button>
        </form>
        <FocusPinToggleForm
          action={recommendedTask.focusRank ? unpinTaskAction : pinTaskAction}
          taskId={recommendedTask.id}
          returnTo="/dashboard"
          isPinned={recommendedTask.focusRank !== null}
          compact
        />
        <Link href={recommendedTaskHref} className="btn-instrument btn-instrument-muted">
          Open task
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge tone="muted">{recommendation.openTaskCount} open</Badge>
        {recommendation.blockedTaskCount > 0 ? (
          <Badge tone="warn">{recommendation.blockedTaskCount} blocked</Badge>
        ) : null}
        {recommendation.pinnedTaskCount > 0 ? (
          <Badge tone="muted">{recommendation.pinnedTaskCount} pinned</Badge>
        ) : null}
      </div>

      {activeTimerError ? (
        <div className="feedback-block feedback-block-error">{activeTimerError}</div>
      ) : null}
    </div>
  );
}

export function FocusPanelCard({ activeTimer, focusPanel }: FocusPanelCardProps) {
  return (
    <Card className="ega-glass">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="glass-label text-[color:var(--signal-live)]">Focus Panel</p>
            <CardTitle className="mt-2 text-xl">Next best work</CardTitle>
            <CardDescription>
              Uses active timer, pinned tasks, due pressure, in-progress momentum, and recent activity to recommend what to do next.
            </CardDescription>
          </div>
          <CardAction>
            <Link href="/tasks" className="glass-label text-signal-live">
              Open tasks
            </Link>
          </CardAction>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <FocusPanelBody
          activeTimer={activeTimer.data}
          activeTimerError={activeTimer.error}
          focusPanel={focusPanel.data}
          focusPanelError={focusPanel.error}
        />
      </CardContent>
    </Card>
  );
}
