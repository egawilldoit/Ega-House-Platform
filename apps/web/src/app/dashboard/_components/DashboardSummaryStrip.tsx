import { ArrowUpRight, Clock3, Target, AlertCircle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { TrendDelta } from "@/components/ui/trend-delta";

type SummaryStripProps = {
  focusItems: number;
  focusDelta?: string | null;
  activeGoals: number;
  goalsTotal: number;
  pendingReviews: number;
  timeTrackedLabel: string;
  timeTrackedDelta?: string | null;
  completionRate: number | null;
};

export function DashboardSummaryStrip({
  focusItems,
  focusDelta,
  activeGoals,
  goalsTotal,
  pendingReviews,
  timeTrackedLabel,
  timeTrackedDelta,
  completionRate,
}: SummaryStripProps) {
  return (
    <section aria-label="Workspace summary" className="grid grid-cols-12 gap-4">
      <Card className="col-span-12 sm:col-span-6 lg:col-span-3 border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-sm)]">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ega-text-tertiary)]">Focus items</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-[var(--ega-text)]">{focusItems}</p>
              <p className="mt-1 text-xs leading-4 text-[var(--ega-text-secondary)]">{completionRate !== null ? `${completionRate}% completed today` : "Today's focus queue"}</p>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] text-[var(--ega-text-secondary)]">
              <Target className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          {focusDelta ? <div className="mt-3"><TrendDelta value={focusDelta} tone="positive" label="vs last week" /></div> : null}
        </CardContent>
      </Card>

      <Card className="col-span-12 sm:col-span-6 lg:col-span-3 border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-sm)]">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ega-text-tertiary)]">Active goals</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-[var(--ega-text)]">{activeGoals}</p>
              <p className="mt-1 text-xs leading-4 text-[var(--ega-text-secondary)]">{goalsTotal} total · steady direction</p>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] text-[var(--ega-text-secondary)]">
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12 sm:col-span-6 lg:col-span-3 border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-sm)]">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ega-text-tertiary)]">Pending reviews</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-[var(--ega-text)]">{pendingReviews}</p>
              <p className="mt-1 text-xs leading-4 text-[var(--ega-text-secondary)]">{pendingReviews > 0 ? "Weekly close needed" : "All caught up"}</p>
            </div>
            <span className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border ${pendingReviews > 0 ? "border-[var(--status-risk-border)] bg-[var(--status-risk-bg)] text-[var(--status-risk)]" : "border-[var(--status-healthy-border)] bg-[var(--status-healthy-bg)] text-[var(--status-healthy)]"}`}>
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12 sm:col-span-6 lg:col-span-3 border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-sm)]">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ega-text-tertiary)]">Time tracked</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-[var(--ega-text)]">{timeTrackedLabel}</p>
              <p className="mt-1 text-xs leading-4 text-[var(--ega-text-secondary)]">Today · focused execution</p>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] text-[var(--ega-text-secondary)]">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          {timeTrackedDelta ? <div className="mt-3"><TrendDelta value={timeTrackedDelta} tone="positive" label="vs last week" /></div> : null}
        </CardContent>
      </Card>
    </section>
  );
}
