import React from "react";
import { Badge } from "@/components/ui/badge";
import { formatTaskDueDate, getTaskDueDateState } from "@/lib/task-due-date";
import { cn } from "@/lib/utils";

type TaskDueDateLabelProps = {
  dueDate: string | null;
  status?: string | null;
  className?: string;
  textClassName?: string;
};

function getDueDateBadgeConfig(state: ReturnType<typeof getTaskDueDateState>) {
  switch (state) {
    case "overdue":
      return { label: "Overdue", tone: "error" as const, textClassName: "text-signal-error" };
    case "today":
      return { label: "Due today", tone: "info" as const, textClassName: "text-signal-live" };
    case "soon":
      return {
        label: "Due soon",
        tone: "warn" as const,
        textClassName: "text-[color:var(--foreground)]",
      };
    default:
      return {
        label: null,
        tone: "muted" as const,
        textClassName: "text-[color:var(--muted-foreground)]",
      };
  }
}

export function TaskDueDateLabel({
  dueDate,
  status,
  className,
  textClassName,
}: TaskDueDateLabelProps) {
  if (!dueDate) {
    return null;
  }

  const dueDateState = getTaskDueDateState(dueDate, status);
  const badgeConfig = getDueDateBadgeConfig(dueDateState);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span
        className={cn(
          "text-xs leading-5",
          badgeConfig.textClassName,
          textClassName,
        )}
      >
        Due {formatTaskDueDate(dueDate)}
      </span>
      {badgeConfig.label ? <Badge tone={badgeConfig.tone}>{badgeConfig.label}</Badge> : null}
    </div>
  );
}
