import { cn } from "@/lib/utils";
import { TrendDelta } from "./trend-delta";

type MetricProps = {
  label: string;
  value: string | number;
  hint?: string;
  delta?: { value: string; tone?: "positive" | "negative" | "neutral"; label?: string };
  tabular?: boolean;
  className?: string;
};

export function Metric({ label, value, hint, delta, tabular = true, className }: MetricProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ega-text-tertiary)]">{label}</span>
      <span className={cn("text-2xl font-semibold tracking-tight text-[var(--ega-text)]", tabular && "tabular-nums")}>{value}</span>
      {hint ? <span className="text-xs leading-4 text-[var(--ega-text-secondary)]">{hint}</span> : null}
      {delta ? <TrendDelta value={delta.value} tone={delta.tone} label={delta.label} /> : null}
    </div>
  );
}

export function MetricCard({ label, value, hint, delta, className }: MetricProps) {
  return (
    <div className={cn("rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[var(--ega-surface)] p-4 shadow-[var(--ega-shadow-sm)]", className)}>
      <Metric label={label} value={value} hint={hint} delta={delta} />
    </div>
  );
}
