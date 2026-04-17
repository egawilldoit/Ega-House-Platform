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
  default: "bg-white border-[var(--border)]",
  green:   "bg-[#e8f5e9] border-[#a5d6a7]",
  cyan:    "bg-[#e3f2fd] border-[#90caf9]",
  muted:   "bg-[var(--instrument-raised)] border-[var(--border)]",
};

const labelColors = {
  default: "text-[color:var(--muted-foreground)]",
  green:   "text-[#1b5e20]",
  cyan:    "text-[#1565c0]",
  muted:   "text-zinc-500",
};

const valueColors = {
  default: "text-[color:var(--foreground)]",
  green:   "text-[#1b5e20]",
  cyan:    "text-[#1565c0]",
  muted:   "text-zinc-700",
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
        "rounded-[var(--radius-card)] border px-5 py-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]",
        variants[variant],
        className,
      )}
      {...props}
    >
      <p className={cn("text-[11px] font-semibold uppercase tracking-[0.14em] mb-2", labelColors[variant])}>
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
          <span className="pb-0.5 text-xs text-[color:var(--muted-foreground)]">{trend}</span>
        )}
      </div>
      {subtitle && (
        <p className="mt-1.5 text-xs text-[color:var(--muted-foreground)]">{subtitle}</p>
      )}
    </div>
  );
}
