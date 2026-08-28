import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type TrendDeltaProps = {
  value: string;
  tone?: "positive" | "negative" | "neutral";
  label?: string;
  className?: string;
};

export function TrendDelta({ value, tone = "neutral", label, className }: TrendDeltaProps) {
  const toneClasses =
    tone === "positive"
      ? "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)] border-[var(--status-healthy-border)]"
      : tone === "negative"
        ? "text-[var(--status-overdue)] bg-[var(--status-overdue-bg)] border-[var(--status-overdue-border)]"
        : "text-[var(--ega-text-secondary)] bg-[var(--ega-surface-subtle)] border-[var(--ega-border)]";

  const Icon = tone === "positive" ? ArrowUpRight : tone === "negative" ? ArrowDownRight : Minus;

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-1.5 py-0.5 text-xs font-medium tabular-nums", toneClasses, className)}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{value}</span>
      {label ? <span className="font-normal text-[var(--ega-text-secondary)]">{label}</span> : null}
    </span>
  );
}
