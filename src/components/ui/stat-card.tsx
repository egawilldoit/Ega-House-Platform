import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatCardProps = HTMLAttributes<HTMLDivElement> & {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: ReactNode;
  variant?: "default" | "green" | "cyan" | "muted";
};

const variants = {
  default: "bg-[var(--bg-card)] border-[var(--border-subtle)]",
  green:   "bg-[var(--accent-green-dim)] border-[var(--accent-green-border)]",
  cyan:    "bg-[var(--accent-cyan-dim)] border-[var(--accent-cyan-border)]",
  muted:   "bg-[var(--surface-1)] border-[var(--border-subtle)]",
};

const labelColors = {
  default: "text-[var(--color-ink-soft)]",
  green:   "text-[var(--accent-green)] opacity-80",
  cyan:    "text-[var(--accent-cyan)] opacity-80",
  muted:   "text-[var(--color-ink-faint)]",
};

const valueColors = {
  default: "text-white",
  green:   "text-[var(--accent-green)]",
  cyan:    "text-[var(--accent-cyan)]",
  muted:   "text-[var(--color-ink-muted)]",
};

export function StatCard({
  label,
  value,
  subtitle,
  trend,
  variant = "default",
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-4",
        variants[variant],
        className,
      )}
      {...props}
    >
      <p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em] mb-2", labelColors[variant])}>
        {label}
      </p>
      <div className="flex items-end justify-between gap-2">
        <p
          className={cn("text-2xl font-bold tracking-tight leading-none", valueColors[variant])}
          style={{ fontFamily: "var(--font-display)" }}
        >
          {value}
        </p>
        {trend && (
          <span className="text-xs text-[var(--color-ink-soft)] pb-0.5">{trend}</span>
        )}
      </div>
      {subtitle && (
        <p className="mt-1.5 text-xs text-[var(--color-ink-faint)]">{subtitle}</p>
      )}
    </div>
  );
}
