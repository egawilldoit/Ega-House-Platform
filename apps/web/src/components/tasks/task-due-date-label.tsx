import React from "react";
import { Badge } from "@/components/ui/badge";
import { formatDisplayDate } from "@/lib/presentation-format";
import { getTaskDueDateState } from "@/lib/task-due-date";
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
      return {
        label: "Overdue",
        tone: "error" as const,
        textClassName: "text-[color:var(--status-overdue)]",
      };
    case "today":
      return {
        label: "Due today",
        tone: "info" as const,
        textClassName: "text-[color:var(--status-info)]",
      };
    case "soon":
      return {
        label: "Due soon",
        tone: "warn" as const,
        textClassName: "text-[color:var(--ega-text)]",
      };
    default:
      return {
        label: null,
        tone: "muted" as const,
        textClassName: "text-[color:var(--ega-text-secondary)]",
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
        Due {formatDisplayDate(dueDate, "detail")}
      </span>
      {badgeConfig.label ? <Badge tone={badgeConfig.tone}>{badgeConfig.label}</Badge> : null}
    </div>
  );
}
