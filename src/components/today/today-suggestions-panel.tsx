import Link from "next/link";

import { startTimerAction, stopTimerAction } from "@/app/timer/actions";
import { addTaskToTodayAction } from "@/app/today/actions";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TodayPlannerTask } from "@/lib/services/today-planner-service";
import { formatTaskToken } from "@/lib/task-domain";

type SuggestionGroup = {
  key: string;
  title: string;
  emptyText: string;
  items: TodayPlannerTask[];
};

type TodaySuggestionsPanelProps = {
  groups: SuggestionGroup[];
  returnTo: string;
  activeTimerSessionId: string | null;
};

function getTaskHref(task: TodayPlannerTask) {
  if (task.projectSlug) {
    return `/tasks/projects/${task.projectSlug}#task-${task.id}`;
  }

  return `/tasks#task-${task.id}`;
}

function SuggestionCard({
  task,
  returnTo,
  activeTimerSessionId,
}: {
  task: TodayPlannerTask;
  returnTo: string;
  activeTimerSessionId: string | null;
}) {
  const isActiveTimerTask = task.hasActiveTimer ? activeTimerSessionId : null;

  return (
    <article className="rounded-[0.9rem] border border-[var(--border)] bg-[color:var(--instrument)] px-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[color:var(--foreground)]">{task.title}</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          {task.projectName}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TaskDueDateLabel dueDate={task.dueDate} status={task.status} />
          {task.focusRank ? <Badge tone="info">Pinned #{task.focusRank}</Badge> : null}
          <Badge tone="muted">{formatTaskToken(task.status)}</Badge>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={addTaskToTodayAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" size="sm" variant="default" aria-label={`Add ${task.title} to Today`}>
            Add to Today
          </Button>
        </form>

        {isActiveTimerTask ? (
          <form action={stopTimerAction}>
            <input type="hidden" name="sessionId" value={isActiveTimerTask} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="sm" variant="danger">
              Stop timer
            </Button>
          </form>
        ) : (
          <form action={startTimerAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="sm" variant="ghost">
              Start timer
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

export function TodaySuggestionsPanel({
  groups,
  returnTo,
  activeTimerSessionId,
}: TodaySuggestionsPanelProps) {
  return (
    <Card className="border-[var(--border)] bg-white">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl">Suggestions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        {groups.map((group) => (
          <section key={group.key} id={`${group.key}-suggestions`} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[color:var(--foreground)]">{group.title}</h3>
              <Badge tone="muted">{group.items.length}</Badge>
            </div>

            {group.items.length > 0 ? (
              <div className="space-y-2">
                {group.items.map((task) => (
                  <SuggestionCard
                    key={task.id}
                    task={task}
                    returnTo={returnTo}
                    activeTimerSessionId={activeTimerSessionId}
                  />
                ))}
                {group.items.length >= 6 ? (
                  <div className="pt-1">
                    <Link href="/tasks" className="glass-label text-signal-live">
                      Show more in tasks
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                {group.emptyText}
              </div>
            )}
          </section>
        ))}

        <div className="rounded-[0.9rem] border border-[var(--border)] bg-[color:var(--instrument)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
          Need a task that isn&apos;t listed here? Open the full queue and add context there.
          <div className="mt-2">
            <Link href="/tasks" className="glass-label text-signal-live">
              Open all tasks
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
