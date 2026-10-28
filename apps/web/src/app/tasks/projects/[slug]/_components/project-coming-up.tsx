import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { buildTaskDrawerLink } from "@/lib/task-drawer-url";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import type { ProjectComingUpItem, ProjectComingUpTask } from "@/lib/project-overview";

type ProjectComingUpProps<T extends ProjectComingUpTask> = {
  items: ProjectComingUpItem<T>[];
  returnTo: string;
  /** Owner timezone used for scheduled labels; defaults to UTC. */
  timezone?: string;
};

const SOURCE_LABELS = {
  due: "Due",
  planned: "Planned",
  scheduled: "Scheduled",
} as const;

function dateLabel<T extends ProjectComingUpTask>(item: ProjectComingUpItem<T>, timezone: string) {
  if (item.source === "scheduled" && item.task.scheduled_start_at) {
    const scheduled = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date(item.task.scheduled_start_at));
    return `${SOURCE_LABELS.scheduled} ${scheduled}`;
  }

  return `${SOURCE_LABELS[item.source]} ${formatTaskDueDate(item.date)}`;
}

export function ProjectComingUp<T extends ProjectComingUpTask>({
  items,
  returnTo,
  timezone = "UTC",
}: ProjectComingUpProps<T>) {
  return (
    <Card
      label="Coming up"
      title="Next scheduled work"
      action={<Badge tone="muted">{items.length}</Badge>}
    >
      {items.length ? (
        <ul className="rows" aria-label="Next due or scheduled tasks">
          {items.map((item) => (
            <li key={item.task.id}>
              <Link
                href={buildTaskDrawerLink(returnTo, item.task.id)}
                className="row row-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
              >
                <CalendarClock
                  className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
                  aria-hidden="true"
                />
                <span className="row-main min-w-0">
                  <span className="row-title block truncate">{item.task.title}</span>
                  <span className="row-meta truncate">{dateLabel(item, timezone)}</span>
                </span>
                <span className="row-actions">
                  <Badge tone={getTaskStatusTone(item.task.status)}>
                    {formatTaskToken(item.task.status)}
                  </Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <CardContent>
          <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
            Nothing is due or scheduled yet. Add a due date or plan a task to see what is next.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
