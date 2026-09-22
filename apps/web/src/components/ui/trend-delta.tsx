import { cn } from "@/lib/utils";
import { MetricDelta } from "@/components/ui/metric";

type TrendDeltaProps = {
  value: string;
  tone?: "positive" | "negative" | "neutral";
  label?: string;
  className?: string;
};

/** @deprecated Use the shared MetricDelta primitive. */
export function TrendDelta({ value, tone = "neutral", label, className }: TrendDeltaProps) {
  return (
    <MetricDelta
      value={value}
      label={label}
      direction={tone === "positive" ? "up" : tone === "negative" ? "down" : "flat"}
      className={cn(className)}
    />
  );
}
