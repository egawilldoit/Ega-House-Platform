import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type StatCardProps = HTMLAttributes<HTMLDivElement> & {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  subtitle?: ReactNode;
  trend?: ReactNode;
  variant?: "default" | "green" | "cyan" | "muted";
};

/**
 * KPI card used across dashboards.
 *
 * Variants are intentionally neutral: data categories come from charts, not
 * from tinted card backgrounds.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  subtitle,
  trend,
  variant = "default",
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)] px-[18px] py-4",
        variant === "muted" && "bg-[color:var(--ega-surface-subtle)]",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)]">
          {label}
        </p>
        {Icon ? (
          <Icon className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]" aria-hidden="true" />
        ) : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-[length:var(--text-metric)] font-semibold leading-none tracking-[var(--tracking-tight)] tabular-nums text-[color:var(--ega-text)]">
          {value}
        </p>
        {trend ? <span className="text-[length:var(--text-meta)]">{trend}</span> : null}
      </div>
      {subtitle ? (
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
