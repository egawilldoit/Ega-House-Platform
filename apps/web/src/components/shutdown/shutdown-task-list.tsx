import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { NotebookPen } from "lucide-react";

type ShutdownTaskListItem = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  blockedReason: string | null;
  projectName: string;
  projectSlug: string | null;
  goalTitle: string | null;
};

type ShutdownTaskListProps = {
  title: string;
  description: string;
  emptyMessage: string;
  tasks: ShutdownTaskListItem[];
  actionLabel?: string;
  action?: (formData: FormData) => Promise<void>;
  returnTo?: string;
};

export function ShutdownTaskList({
  title,
  description,
  emptyMessage,
  tasks,
  actionLabel,
  action,
  returnTo = "/shutdown",
}: ShutdownTaskListProps) {
  return (
    <Card className="border-[var(--border)] bg-white">
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-[color:var(--foreground)]">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">{description}</p>
        </div>

        {tasks.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title={`No ${title.toLowerCase()} yet`}
            description={emptyMessage}
          />
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="rounded-[0.95rem] border border-[var(--border)] bg-[color:var(--instrument)] px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                      {task.title}
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                      {task.projectSlug ? (
                        <Link href={`/tasks/projects/${task.projectSlug}`} className="hover:underline">
                          {task.projectName}
                        </Link>
                      ) : (
                        task.projectName
                      )}
                      {task.goalTitle ? ` · ${task.goalTitle}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={task.status} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone="muted">
                    {task.dueDate ? `Due ${formatTaskDueDate(task.dueDate)}` : "No due date"}
                  </Badge>
                  {task.blockedReason ? <Badge tone="warn">Blocked: {task.blockedReason}</Badge> : null}
                </div>

                {action && actionLabel ? (
                  <form action={action} className="mt-3">
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button
                      type="submit"
                      className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs"
                    >
                      {actionLabel}
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
