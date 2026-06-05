import Link from "next/link";

import { Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

import { RelativeTime } from "./RelativeTime";
import type { DashboardData } from "../_lib/dashboard-data";

interface TimerSummaryCardProps {
  summary: DashboardData["timerSummary"];
  activeTimer: DashboardData["activeTimer"];
}

function DashboardMetric({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "accent";
}) {
  return (
    <div className={`ega-dashboard-metric ${tone === "accent" ? "is-accent" : ""}`}>
      <p className="glass-label">{label}</p>
      <p className="ega-dashboard-metric-value">{value}</p>
      <p className="ega-dashboard-metric-detail">{detail}</p>
    </div>
  );
}

export function TimerSummaryCard({ summary, activeTimer }: TimerSummaryCardProps) {
  return (
    <Card className="ega-glass">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="glass-label text-[color:var(--signal-live)]">Timer Summary</p>
            <CardTitle className="mt-2 text-xl">Session and delivery cadence</CardTitle>
            <CardDescription>
              Session volume, total tracked time, and live timer context.
            </CardDescription>
          </div>
          <CardAction>
            <Link href="/timer" className="glass-label text-signal-live">
              Open timer
            </Link>
          </CardAction>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {summary.error ? (
          <div className="feedback-block feedback-block-error">{summary.error}</div>
        ) : summary.data ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <DashboardMetric
                label="Today"
                value={summary.data.trackedTodayLabel}
                detail={`${summary.data.sessionsTodayCount} session${summary.data.sessionsTodayCount === 1 ? "" : "s"} logged`}
                tone="accent"
              />
              <DashboardMetric
                label="Total"
                value={summary.data.trackedTotalLabel}
                detail="Across loaded task sessions"
              />
              <DashboardMetric
                label="Longest"
                value={summary.data.longestSessionLabel ?? "--"}
                detail={summary.data.longestSessionTaskTitle ?? "No completed session yet"}
              />
            </div>

            {activeTimer.data ? (
              <div className="rounded-[1.1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="glass-label text-[color:var(--signal-live)]">Active timer</p>
                    <p className="mt-2 text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
                      {activeTimer.data.taskTitle}
                    </p>
                    <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                      {activeTimer.data.projectName} · Started <RelativeTime isoString={activeTimer.data.startedAt} />
                    </p>
                  </div>
                  <Badge tone="active">{activeTimer.data.elapsedLabel}</Badge>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={Clock3}
            title="Timer summary unavailable"
            description="Tracked sessions will appear once timer history is available."
          />
        )}
      </CardContent>
      <CardFooter>
        <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          Summary cards are sized to current activity rather than fixed panel height.
        </p>
      </CardFooter>
    </Card>
  );
}
