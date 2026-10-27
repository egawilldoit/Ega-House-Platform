import { SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import { cn } from "@/lib/utils";

const PRIORITY_LABELS = {
  low: "Low priority",
  medium: "Medium priority",
  high: "High priority",
  urgent: "Urgent priority",
} as const;

export type TaskPriorityIconName = keyof typeof PRIORITY_LABELS;

const PRIORITY_ICONS = {
  low: SignalLow,
  medium: SignalMedium,
  high: SignalHigh,
  // `urgent` shares the high token: the priority token namespace has no
  // separate urgent colour and the existing surfaces already do this.
  urgent: SignalHigh,
} as const;

const PRIORITY_CLASSES: Record<TaskPriorityIconName, string> = {
  low: "text-[color:var(--ega-text-tertiary)]",
  medium: "text-[color:var(--priority-medium)]",
  high: "text-[color:var(--priority-high)]",
  urgent: "text-[color:var(--priority-high)]",
};

type PriorityIconProps = {
  priority: TaskPriorityIconName;
  /** Override the accessible name; defaults to the priority label. */
  label?: string;
  /** Hide from assistive tech when a visible label already names the priority. */
  decorative?: boolean;
  className?: string;
};

/** Canonical task-priority glyph, coloured from the `priority-*` tokens. */
export function PriorityIcon({
  priority,
  label,
  decorative = false,
  className,
}: PriorityIconProps) {
  const Icon = PRIORITY_ICONS[priority];
  const accessibleName = label ?? PRIORITY_LABELS[priority];

  return (
    <Icon
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : accessibleName}
      role={decorative ? undefined : "img"}
      className={cn("size-3.5 shrink-0", PRIORITY_CLASSES[priority], className)}
    />
  );
}

export function taskPriorityLabel(priority: TaskPriorityIconName) {
  return PRIORITY_LABELS[priority];
}
