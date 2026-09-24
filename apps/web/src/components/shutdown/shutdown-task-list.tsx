import Link from "next/link";
import { NotebookPen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTaskDueDate } from "@/lib/task-due-date";

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
  actionPendingLabel?: string;
  action?: (formData: FormData) => Promise<void>;
  returnTo?: string;
};

export function ShutdownTaskList({
  title,
  description,
  emptyMessage,
  tasks,
  actionLabel,
  actionPendingLabel,
  action,
  returnTo = "/shutdown",
}: ShutdownTaskListProps) {
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

      {tasks.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title={`No ${title.toLowerCase()} yet`}
          description={emptyMessage}
        />
      ) : (
        <ul className="rows">
          {tasks.map((task) => (
            <li key={task.id} className="row">
              <div className="row-main">
                <span className="row-title">{task.title}</span>
                <span className="row-meta">
                  {task.projectSlug ? (
                    <Link href={`/tasks/projects/${task.projectSlug}`} className="hover:underline">
                      {task.projectName}
                    </Link>
                  ) : (
                    task.projectName
                  )}
                  {task.goalTitle ? ` · ${task.goalTitle}` : ""}
                  {` · ${task.dueDate ? `due ${formatTaskDueDate(task.dueDate)}` : "no due date"}`}
                </span>
                {task.blockedReason ? (
                  <span className="row-meta text-[color:var(--status-overdue)]">
                    Blocked: {task.blockedReason}
                  </span>
                ) : null}
              </div>

              <div className="row-actions flex-wrap justify-end">
                <StatusBadge status={task.status} />
                {action && actionLabel ? (
                  <form action={action}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <PendingSubmitButton
                      type="submit"
                      size="sm"
                      variant="muted"
                      className="inline-flex items-center"
                      pendingLabel={actionPendingLabel ?? `${actionLabel}…`}
                    >
                      {actionLabel}
                    </PendingSubmitButton>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
