import React from "react";
import { Badge } from "@/components/ui/badge";
import { StatusIcon, type TaskStatusIconName } from "@/components/ui/status-icon";
import { cn } from "@/lib/utils";

const STATUS_COPY: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
  blocked: "Blocked",
  due_today: "Due today",
  due_soon: "Due soon",
  urgent: "Urgent",
  active: "Active",
  archived: "Archived",
};

const STATUS_TONE: Record<string, "muted" | "info" | "warn" | "success" | "error"> = {
  todo: "muted",
  in_progress: "info",
  review: "warn",
  done: "success",
  blocked: "error",
  due_today: "warn",
  due_soon: "warn",
  urgent: "error",
  active: "success",
  archived: "muted",
};

type StatusBadgeProps = {
  status: string;
  label?: string;
  className?: string;
};

const ICON_STATUSES: TaskStatusIconName[] = ["todo", "in_progress", "review", "done", "blocked"];

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  const tone = STATUS_TONE[normalized] ?? "muted";
  const resolvedLabel =
    label ??
    STATUS_COPY[normalized] ??
    normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  // The badge always renders the status text, so the glyph is decorative here.
  const iconStatus = ICON_STATUSES.includes(normalized as TaskStatusIconName)
    ? (normalized as TaskStatusIconName)
    : null;

  return (
    <Badge tone={tone} className={cn("status-badge-app gap-1", className)}>
      {iconStatus ? <StatusIcon status={iconStatus} decorative className="size-3" /> : null}
      {resolvedLabel}
    </Badge>
  );
}
