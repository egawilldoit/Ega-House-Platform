import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatTaskEstimate } from "@/lib/task-estimate";

type TodaySummaryBarProps = {
  plannedCount: number;
  inProgressCount: number;
  blockedCount: number;
  completedCount: number;
  totalEstimateMinutes: number;
  trackedTodayLabel: string;
};

function SummaryMetric({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "info" | "warn" | "success";
}) {
  return (
    <div className="rounded-[0.9rem] border border-[var(--border)] bg-[color:var(--instrument)] px-3 py-3">
      <p className="glass-label text-etch">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--foreground)]">{value}</p>
      <div className="mt-2">
        <Badge tone={tone}>{label}</Badge>
      </div>
    </div>
  );
}

export function TodaySummaryBar({
  plannedCount,
  inProgressCount,
  blockedCount,
  completedCount,
  totalEstimateMinutes,
  trackedTodayLabel,
}: TodaySummaryBarProps) {
  return (
    <Card className="border-[var(--border)] bg-white">
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryMetric label="Planned" value={String(plannedCount)} tone="muted" />
        <SummaryMetric label="In progress" value={String(inProgressCount)} tone="info" />
        <SummaryMetric label="Blocked" value={String(blockedCount)} tone="warn" />
        <SummaryMetric label="Completed" value={String(completedCount)} tone="success" />
        <SummaryMetric
          label="Estimated"
          value={totalEstimateMinutes > 0 ? (formatTaskEstimate(totalEstimateMinutes) ?? "--") : "--"}
          tone="muted"
        />
        <SummaryMetric label="Tracked today" value={trackedTodayLabel} tone="info" />
      </CardContent>
    </Card>
  );
}
