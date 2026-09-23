import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ProgressBarProps = HTMLAttributes<HTMLDivElement> & {
  value: number; // 0-100
  max?: number;
  variant?: "green" | "cyan" | "neutral";
  size?: "sm" | "md";
  /**
   * Accessible name for what this bar measures. Required in practice: a bare
   * progressbar announces a percentage with no subject, and work progress,
   * linked-task completion and time allocation must not sound identical.
   */
  label?: string;
  /** Spoken value, e.g. "63% of today's planned work". */
  valueText?: string;
};

const variants = {
  green: "bg-[var(--ega-data-blue)]",
  cyan: "bg-[var(--ega-data-purple)]",
  neutral: "bg-[var(--ega-ink)]",
};

const sizes = {
  sm: "h-1.5",
  md: "h-2",
};

export function ProgressBar({
  value,
  max = 100,
  variant = "neutral",
  size = "sm",
  label,
  valueText,
  className,
  ...props
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  const rounded = Math.round(pct);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={rounded}
      aria-valuetext={valueText ?? `${rounded}%`}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--ega-surface-muted)]",
        sizes[size],
        className,
      )}
      {...props}
    >
      <div
        className={cn("h-full rounded-[var(--radius-pill)]", variants[variant])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
