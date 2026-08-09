import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_COPY: Record<string, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
  due_today: "Due today",
  due_soon: "Due soon",
  urgent: "Urgent",
};

const STATUS_TONE: Record<string, "muted" | "info" | "warn" | "success" | "error"> = {
  todo: "muted",
  in_progress: "info",
  done: "success",
  blocked: "error",
  due_today: "warn",
  due_soon: "warn",
  urgent: "error",
};

type StatusBadgeProps = {
  status: string;
  label?: string;
  className?: string;
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  const tone = STATUS_TONE[normalized] ?? "muted";
  const resolvedLabel =
    label ??
    STATUS_COPY[normalized] ??
    normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  return (
    <Badge tone={tone} className={cn("status-badge-app", className)}>
      {resolvedLabel}
    </Badge>
  );
}
