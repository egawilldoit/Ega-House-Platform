import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

type MetricDeltaProps = {
  /** Already formatted, e.g. "+12%" or "3 fewer". */
  value: string;
  direction?: "up" | "down" | "flat";
  /** Whether "up" is good. Defaults to true; cost metrics can invert it. */
  higherIsBetter?: boolean;
  label?: string;
  className?: string;
};

/**
 * Directional change next to a metric.
 *
 * Direction is always accompanied by an icon and a text label, so colour is
 * never the only carrier of meaning.
 */
export function MetricDelta({
  value,
  direction = "flat",
  higherIsBetter = true,
  label,
  className,
}: MetricDeltaProps) {
  const positive =
    direction === "flat" ? null : (direction === "up") === higherIsBetter;
  const Icon =
    direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

  return (
    <span
      className={cn(
        "metric-delta",
        positive === null
          ? "metric-delta-flat"
          : positive
            ? "metric-delta-up"
            : "metric-delta-down",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{value}</span>
      {label ? <span className="text-[color:var(--ega-text-tertiary)]">{label}</span> : null}
    </span>
  );
}

type MetricProps = {
  label: string;
  value: ReactNode;
  /** Short qualifier under the value, e.g. "tasks due today". */
  caption?: ReactNode;
  delta?: ReactNode;
  icon?: ReactNode;
  size?: "md" | "lg";
  className?: string;
};

/** The single metric grammar shared by Home, Today, Analytics, and Review. */
export function Metric({
  label,
  value,
  caption,
  delta,
  icon,
  size = "md",
  className,
}: MetricProps) {
  return (
    <div className={cn("metric", className)}>
      <div className="metric-label">
        {icon ? (
          <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span>{label}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn("metric-value", size === "lg" && "metric-value-lg")}>{value}</span>
        {delta}
      </div>
      {caption ? <div className="metric-caption">{caption}</div> : null}
    </div>
  );
}

type CompactStatProps = {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  className?: string;
};

/** Denser metric used inside KPI strips and side rails. */
export function CompactStat({ label, value, caption, className }: CompactStatProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)]">
        {label}
      </span>
      <span className="text-[length:var(--text-metric)] font-semibold leading-none tracking-[var(--tracking-tight)] tabular-nums text-[color:var(--ega-text)]">
        {value}
      </span>
      {caption ? (
        <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          {caption}
        </span>
      ) : null}
    </div>
  );
}

type DataLegendProps = {
  items: { label: string; value?: ReactNode; color: string }[];
  className?: string;
};

/** Accessible legend for multi-series charts and breakdowns. */
export function DataLegend({ items, className }: DataLegendProps) {
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-[length:var(--text-meta-lg)]">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ background: item.color }}
          />
          <span className="min-w-0 flex-1 truncate text-[color:var(--ega-text-secondary)]">
            {item.label}
          </span>
          {item.value !== undefined ? (
            <span className="tabular-nums font-medium text-[color:var(--ega-text)]">
              {item.value}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
