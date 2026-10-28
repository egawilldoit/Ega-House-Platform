import { taskActivityActorLabel, type TaskActivityItem } from "@/lib/task-activity";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatTimerDateTime } from "@/lib/timer-domain";

type ProjectActivityCardProps = {
  items: TaskActivityItem[];
  taskTitles: Map<string, string>;
};

export function ProjectActivityCard({ items, taskTitles }: ProjectActivityCardProps) {
  return (
    <Card
      label="Activity"
      title="Recent activity"
      action={<Badge tone="muted">{items.length}</Badge>}
    >
      {items.length ? (
        <ul className="rows max-h-[22rem] overflow-y-auto" aria-label="Recent project activity">
          {items.map((item) => (
            <li key={item.id} className="row items-start">
              <span className="row-main min-w-0">
                <span className="row-title truncate">
                  {(item.taskId && taskTitles.get(item.taskId)) || "Task"}
                </span>
                <span className="row-meta line-clamp-2">{item.summary}</span>
                <span className="row-meta">
                  {taskActivityActorLabel(item.actor)} · {formatTimerDateTime(item.occurredAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <CardContent>
          <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
            No task activity has been recorded for this project yet.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
