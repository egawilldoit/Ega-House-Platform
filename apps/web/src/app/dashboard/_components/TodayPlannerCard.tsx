import Link from "next/link";

import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { formatTaskToken } from "@/lib/task-domain";
import { pinTaskAction, unpinTaskAction } from "@/app/tasks/actions";
import { Target } from "lucide-react";

import { RelativeTime } from "./RelativeTime";
import type { DashboardData, DashboardTodayTask } from "../_lib/dashboard-data";

interface TodayPlannerCardProps {
  planner: DashboardData["todayPlanner"];
}

function TaskRow({ task, showPinAction = true }: { task: DashboardTodayTask; showPinAction?: boolean }) {
  return (
    <article className="ega-dashboard-list-row">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              task.status === "blocked" || task.priority === "urgent"
                ? "bg-[var(--signal-error)]"
                : task.priority === "high"
                  ? "bg-[var(--signal-warn)]"
                  : task.status === "in_progress"
                    ? "bg-[var(--signal-info)]"
                    : "bg-[var(--signal-live)]"
            }`}
          />
          <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
            {task.title}
          </p>
        </div>
        <p className="mt-2 text-xs leading-6 text-[color:var(--muted-foreground)]">
          {task.projectName}
          {task.goalTitle ? ` · ${task.goalTitle}` : ""} · Updated <RelativeTime isoString={task.updatedAt} />
        </p>
        {task.status === "blocked" && task.blockedReason?.trim() ? (
          <p className="mt-2 rounded-[0.8rem] border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.06)] px-3 py-2 text-sm leading-6 text-[var(--signal-error)]">
            Blocked: {task.blockedReason.trim()}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TaskDueDateLabel dueDate={task.dueDate} status={task.status} />
          {task.estimateMinutes ? (
            <Badge tone="muted">Est. {formatTaskEstimate(task.estimateMinutes)}</Badge>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <StatusBadge status={task.status} />
        <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
        {task.focusRank ? <Badge tone="info">Pinned #{task.focusRank}</Badge> : null}
        {showPinAction ? (
          <FocusPinToggleForm
            action={task.focusRank ? unpinTaskAction : pinTaskAction}
            taskId={task.id}
            returnTo="/dashboard"
            isPinned={task.focusRank !== null}
            compact
          />
        ) : null}
      </div>
    </article>
  );
}

export function TodayPlannerCard({ planner }: TodayPlannerCardProps) {
  return (
    <Card className="ega-glass">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="glass-label text-[color:var(--signal-live)]">Execution Queue</p>
            <CardTitle className="mt-2 text-xl">Today planner</CardTitle>
            <CardDescription>
              The newest work items shaping today&apos;s execution pressure.
            </CardDescription>
          </div>
          <CardAction>
            <Link href="/today" className="glass-label text-signal-live">
              Open Today
            </Link>
          </CardAction>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {planner.error ? (
          <div className="feedback-block feedback-block-error">{planner.error}</div>
        ) : planner.data && planner.data.all.length > 0 ? (
          <div className="space-y-4">
            {[
              { key: "planned", label: "Planned", items: planner.data.planned },
              { key: "in-progress", label: "In progress", items: planner.data.inProgress },
              { key: "blocked", label: "Blocked", items: planner.data.blocked },
              { key: "completed", label: "Completed", items: planner.data.completed, showPinAction: false },
            ]
              .filter((section) => section.items.length > 0)
              .map((section) => (
                <div key={section.key} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="glass-label text-etch">{section.label}</p>
                    <Badge tone="muted">{section.items.length}</Badge>
                  </div>
                  {section.items.slice(0, 4).map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      showPinAction={section.showPinAction !== false}
                    />
                  ))}
                </div>
              ))}
          </div>
        ) : (
          <EmptyState
            icon={Target}
            title="Today lane is empty"
            description="Pin a task, start a timer, or set a due date to shape the plan."
            actionLabel="Open Today"
            actionHref="/today"
          />
        )}
      </CardContent>
    </Card>
  );
}
