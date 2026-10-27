import { Ban, CheckCircle2, Circle, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_LABELS = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
} as const;

export type TaskStatusIconName = keyof typeof STATUS_LABELS;

const STATUS_ICONS = {
  todo: Circle,
  in_progress: CircleDot,
  done: CheckCircle2,
  blocked: Ban,
} as const;

const STATUS_CLASSES: Record<TaskStatusIconName, string> = {
  todo: "text-[color:var(--ega-text-tertiary)]",
  in_progress: "text-[color:var(--status-info)]",
  done: "text-[color:var(--status-healthy)]",
  blocked: "text-[color:var(--status-overdue)]",
};

type StatusIconProps = {
  status: TaskStatusIconName;
  /** Override the accessible name; defaults to the status label. */
  label?: string;
  /** Hide from assistive tech when a visible label already names the status. */
  decorative?: boolean;
  className?: string;
};

/**
 * Canonical task-status glyph. Colour comes from the `status-*` token
 * namespace, so it follows the light/dark theme without hard-coded values.
 */
export function StatusIcon({ status, label, decorative = false, className }: StatusIconProps) {
  const Icon = STATUS_ICONS[status];
  const accessibleName = label ?? STATUS_LABELS[status];

  return (
    <Icon
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : accessibleName}
      role={decorative ? undefined : "img"}
      className={cn("size-3.5 shrink-0", STATUS_CLASSES[status], className)}
    />
  );
}

export function taskStatusLabel(status: TaskStatusIconName) {
  return STATUS_LABELS[status];
}
