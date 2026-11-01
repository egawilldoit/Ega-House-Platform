import { taskActivityActorLabel, type TaskActivityItem } from "@/lib/task-activity";

import { AgentBadge } from "@/components/agents/agent-badge";
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
                <span className="row-meta flex flex-wrap items-center gap-1">
                  {item.actor.kind === "agent" ? (
                    <AgentBadge
                      displayName={taskActivityActorLabel(item.actor)}
                      showKind={false}
                      size="sm"
                    />
                  ) : (
                    <span>{taskActivityActorLabel(item.actor)}</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{formatTimerDateTime(item.occurredAt)}</span>
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
