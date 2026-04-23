import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { SessionHeatmap } from "@/components/review/session-heatmap";
import { WeekBarChart } from "@/components/review/week-bar-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatDateTime,
  formatIsoDate,
  getTodayIsoDate,
  getWeekBounds,
  getWeekWindow,
  isIsoDate,
  shiftIsoDateByDays,
} from "@/lib/review-week";
import { getRecentDailyTrackedTime } from "@/lib/review-session-heatmap";
import { createClient } from "@/lib/supabase/server";
import { buildMostTrackedInsights, type MostTrackedInsights } from "@/lib/review-most-tracked";
import { getTaskSessionDurationSeconds } from "@/lib/task-session";
import { isMissingTasksBlockedReasonColumn } from "@/lib/supabase-error";

import { ReviewForm } from "./review-form";
import {
  getEmptyReviewFormValues,
  getReviewFormValuesFromRecord,
} from "./review-form-state";
import { WeekSelector } from "./week-selector";

export const metadata: Metadata = {
  title: "Review | EGA House",
  description: "Weekly review reflection workflow.",
};

const PAST_REVIEW_LIMIT = 100;

type ReviewPageProps = { searchParams: Promise<{ weekOf?: string }> };

type WeeklyStats = {
  tasksCreated: number;
  sessionsLogged: number;
  trackedSeconds: number;
  goalsTouched: number;
  goalStatusCounts: Array<{ status: string; count: number }>;
  blockedTasks: Array<{
    id: string;
    title: string;
    blockedReason: string | null;
    updatedAt: string;
  }>;
};

type ReviewBlockedTaskRow = {
  id: string;
  title: string;
  blocked_reason: string | null;
  updated_at: string;
};

async function getReviewBlockedTasks(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ data: ReviewBlockedTaskRow[]; error: string | null }> {
  const primaryResult = await supabase
    .from("tasks")
    .select("id, title, blocked_reason, updated_at")
    .eq("status", "blocked")
    .order("updated_at", { ascending: false })
    .limit(6);

  if (!primaryResult.error) {
    return {
      data: (primaryResult.data ?? []) as ReviewBlockedTaskRow[],
      error: null,
    };
  }

  if (!isMissingTasksBlockedReasonColumn(primaryResult.error)) {
    return { data: [], error: primaryResult.error.message };
  }

  const fallbackResult = await supabase
    .from("tasks")
    .select("id, title, updated_at")
    .eq("status", "blocked")
    .order("updated_at", { ascending: false })
    .limit(6);

  if (fallbackResult.error) {
    return { data: [], error: fallbackResult.error.message };
  }

  return {
    data: (fallbackResult.data ?? []).map((task) => ({
      ...task,
      blocked_reason: null,
    })),
    error: null,
  };
}

async function getMostTrackedInsights(
  weekStart: string,
  weekEnd: string,
): Promise<MostTrackedInsights> {
  const { startIso, endExclusiveIso } = getWeekWindow(weekStart, weekEnd);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_sessions")
    .select(
      "task_id, started_at, ended_at, duration_seconds, tasks(id, title, projects(id, name, slug), goals(id, title))",
    )
    .lt("started_at", endExclusiveIso)
    .or(`ended_at.is.null,ended_at.gte.${startIso}`);

  if (error) {
    throw new Error(`Failed to load most tracked insights: ${error.message}`);
  }

  return buildMostTrackedInsights(data ?? [], {
    startIso,
    endIso: endExclusiveIso,
  });
}

function toSummaryPreview(summary: string | null, maxLength = 200) {
  const normalized = summary?.trim() ?? "";
  if (!normalized) {
    return "No summary text.";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

async function getPastReviews() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("week_reviews")
    .select("id, week_start, week_end, summary, created_at, updated_at")
    .order("week_start", { ascending: false })
    .limit(PAST_REVIEW_LIMIT);
  if (error) {
    throw new Error(`Failed to load reviews: ${error.message}`);
  }
  return data;
}

async function getSelectedWeekReview(weekStart: string, weekEnd: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("week_reviews")
    .select("id, summary, wins, blockers, next_steps, created_at, updated_at")
    .eq("week_start", weekStart)
    .eq("week_end", weekEnd)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`Failed to load selected week reviews: ${error.message}`);
  }
  return data?.[0] ?? null;
}

async function getWeeklyStats(weekStart: string, weekEnd: string): Promise<WeeklyStats> {
  const { startIso, endExclusiveIso } = getWeekWindow(weekStart, weekEnd);
  const nowIso = new Date().toISOString();
  const sessionNowIso = nowIso < endExclusiveIso ? nowIso : endExclusiveIso;
  const supabase = await createClient();
  const [tasksResult, sessionsResult, goalsResult, blockedTasksResult] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startIso)
      .lt("created_at", endExclusiveIso),
    supabase
      .from("task_sessions")
      .select("id, task_id, started_at, ended_at, duration_seconds")
      .gte("started_at", startIso)
      .lt("started_at", endExclusiveIso),
    supabase
      .from("goals")
      .select("id, status")
      .gte("updated_at", startIso)
      .lt("updated_at", endExclusiveIso),
    getReviewBlockedTasks(supabase),
  ]);
  if (tasksResult.error) {
    throw new Error(`Failed to load weekly task stats: ${tasksResult.error.message}`);
  }
  if (sessionsResult.error) {
    throw new Error(`Failed to load weekly session stats: ${sessionsResult.error.message}`);
  }
  if (goalsResult.error) {
    throw new Error(`Failed to load weekly goal stats: ${goalsResult.error.message}`);
  }
  if (blockedTasksResult.error) {
    throw new Error(`Failed to load blocked tasks: ${blockedTasksResult.error}`);
  }
  const trackedSeconds = (sessionsResult.data ?? []).reduce(
    (total, session) => total + getTaskSessionDurationSeconds(session, sessionNowIso),
    0,
  );
  const goalStatusCounts = Array.from(
    (goalsResult.data ?? []).reduce<Map<string, number>>((counts, goal) => {
      counts.set(goal.status, (counts.get(goal.status) ?? 0) + 1);
      return counts;
    }, new Map()),
  )
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status))
    .slice(0, 3);
  return {
    tasksCreated: tasksResult.count ?? 0,
    sessionsLogged: sessionsResult.data?.length ?? 0,
    trackedSeconds,
    goalsTouched: goalsResult.data?.length ?? 0,
    goalStatusCounts,
    blockedTasks: (blockedTasksResult.data ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      blockedReason: task.blocked_reason,
      updatedAt: task.updated_at,
    })),
  };
}

async function getRecentSessionHeatmap() {
  const supabase = await createClient();
  return getRecentDailyTrackedTime(supabase);
}

function StatPanel({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <Card className="border-[var(--border)] bg-white">
      <CardContent className="flex h-full flex-col justify-between px-6 pb-6 pt-6">
        <div className="glass-label text-etch">{label}</div>
        <div
          className={`text-4xl font-semibold tracking-tight ${
            accent ? "text-signal-live" : "text-[color:var(--foreground)]"
          }`}
        >
          {value}
        </div>
        <div
          className={`text-sm ${
            accent ? "text-signal-live" : "text-[color:var(--muted-foreground)]"
          }`}
        >
          {detail}
        </div>
      </CardContent>
    </Card>
  );
}

function getVelocityBand(velocity: number) {
  if (velocity >= 75) {
    return { label: "High output", tone: "success" as const };
  }
  if (velocity >= 40) {
    return { label: "On track", tone: "info" as const };
  }
  if (velocity >= 20) {
    return { label: "Light week", tone: "warn" as const };
  }
  return { label: "Early cycle", tone: "muted" as const };
}

function MostTrackedSection({
  title,
  rows,
}: {
  title: string;
  rows: MostTrackedInsights[keyof MostTrackedInsights];
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[color:var(--foreground)]">{title}</h3>
        <Badge tone="muted">{rows.length}</Badge>
      </div>
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row, index) => {
            const content = (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(34,197,94,0.1)] text-xs font-semibold text-signal-live">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[color:var(--foreground)]">
                      {row.label}
                    </div>
                    <div className="truncate text-xs text-[color:var(--muted-foreground)]">
                      {row.detail}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">
                    {row.trackedLabel}
                  </div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {row.sessionCount} session{row.sessionCount === 1 ? "" : "s"}
                  </div>
                </div>
              </>
            );

            const className =
              "flex items-center justify-between gap-4 rounded-[0.95rem] border border-[var(--border)] bg-[color:var(--instrument)] px-3 py-3";

            return row.href ? (
              <Link
                key={row.id}
                href={row.href}
                className={`${className} transition hover:bg-[color:var(--instrument-raised)]`}
              >
                {content}
              </Link>
            ) : (
              <div key={row.id} className={className}>
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="surface-empty px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
          No tracked {title.toLowerCase()} in this weekly window yet.
        </div>
      )}
    </div>
  );
}

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedWeekOf =
    resolvedSearchParams.weekOf && isIsoDate(resolvedSearchParams.weekOf)
      ? resolvedSearchParams.weekOf
      : getTodayIsoDate();
  const bounds = getWeekBounds(selectedWeekOf);
  if (!bounds) {
    throw new Error("Failed to resolve selected week.");
  }
  const [pastReviews, selectedReview, weeklyStats, sessionHeatmap, mostTrackedInsights] =
    await Promise.all([
      getPastReviews(),
      getSelectedWeekReview(bounds.weekStart, bounds.weekEnd),
      getWeeklyStats(bounds.weekStart, bounds.weekEnd),
      getRecentSessionHeatmap(),
      getMostTrackedInsights(bounds.weekStart, bounds.weekEnd),
    ]);

  const cycleVelocity = Math.min(
    100,
    Math.round((weeklyStats.trackedSeconds / (40 * 60 * 60)) * 100),
  );
  const reviewFormDefaults = selectedReview
    ? getReviewFormValuesFromRecord(selectedReview, selectedWeekOf)
    : getEmptyReviewFormValues(selectedWeekOf);
  const blockerCount = weeklyStats.blockedTasks.length;
  const velocityBand = getVelocityBand(cycleVelocity);
  const sparseHeatmap = sessionHeatmap.filter((entry) => entry.trackedSeconds > 0).length < 5;
  const weekBarData = sessionHeatmap.slice(-7);

  return (
    <AppShell
      eyebrow="Cycle Summary"
      title="Weekly Review"
      description="Weekly summary, highlights, blockers, and saved reflection snapshots."
      actions={
        <div className="flex flex-col items-end gap-2 text-right">
          <a
            href={`/review/export?weekOf=${selectedWeekOf}`}
            className="btn-instrument btn-instrument-muted flex h-8 items-center px-4"
          >
            Export CSV
          </a>
          <div className="text-sm font-semibold text-signal-live">
            {formatIsoDate(bounds.weekStart)} - {formatIsoDate(bounds.weekEnd)}
          </div>
          <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
            Report generated {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      }
    >
      <div className="mb-6">
        <WeekSelector
          selectedWeekOf={selectedWeekOf}
          weekStart={bounds.weekStart}
          weekEnd={bounds.weekEnd}
          previousWeekOf={shiftIsoDateByDays(selectedWeekOf, -7)}
          nextWeekOf={shiftIsoDateByDays(selectedWeekOf, 7)}
          existingReviewCount={selectedReview ? 1 : 0}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-12">
        <div className="md:col-span-8">
          <Card className="border-[var(--border)] bg-white">
            <CardContent className="px-7 pb-7 pt-7">
              <div className="glass-label text-etch mb-4 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--signal-live)]" />
                Cycle Velocity
              </div>
              <div className="text-6xl font-semibold tracking-tight text-[color:var(--foreground)]">
                {cycleVelocity}
                <span className="ml-1 text-2xl text-[color:var(--muted-foreground)]">%</span>
              </div>
              <div className="mt-3">
                <Badge tone={velocityBand.tone}>{velocityBand.label}</Badge>
              </div>
              <p className="mt-4 max-w-xl text-sm leading-7 text-[color:var(--muted-foreground)]">
                Weekly focus utilization against a 40-hour operating target, derived from
                tracked task sessions and review-period activity. Export CSV to download the
                selected cycle with saved reflection fields and computed weekly stats.
              </p>
              <div className="mt-6 flex flex-wrap gap-4">
                <div className="surface-subtle px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--foreground)]">
                  +{weeklyStats.tasksCreated} tasks this cycle
                </div>
                <div className="surface-subtle px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--foreground)]">
                  {Math.round(weeklyStats.trackedSeconds / 3600)}h logged
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-4 flex flex-col gap-6">
          <StatPanel
            label="Tasks Created"
            value={weeklyStats.tasksCreated.toString()}
            detail={`${weeklyStats.sessionsLogged} sessions logged`}
          />
          <StatPanel
            label="Blockers / Drift"
            value={`${blockerCount}`}
            detail={`${weeklyStats.goalsTouched} goals touched this cycle`}
            accent={blockerCount === 0}
          />
        </div>
      </div>

      <div className="mt-6">
        {sparseHeatmap ? <WeekBarChart data={weekBarData} /> : <SessionHeatmap data={sessionHeatmap} />}
      </div>

      <div className="mt-6">
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="px-6 pb-6 pt-6">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
              <div>
                <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
                  Most Tracked This Week
                </h2>
                <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                  Ranked directly from task session time inside the selected weekly window.
                </p>
              </div>
              <Badge tone="muted">Task sessions</Badge>
            </div>
            <div className="grid gap-6 lg:grid-cols-3">
              <MostTrackedSection title="Tasks" rows={mostTrackedInsights.tasks} />
              <MostTrackedSection title="Projects" rows={mostTrackedInsights.projects} />
              <MostTrackedSection title="Goals" rows={mostTrackedInsights.goals} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)]">
        <div className="space-y-6">
          <div>
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
                Key Highlights
              </h2>
              <span className="rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] px-2 py-1 text-xs text-[color:var(--muted-foreground)]">
                Automated Sync
              </span>
            </div>

            <div className="space-y-4">
              <Card className="border-[var(--border)] bg-white">
                <CardContent className="px-5 pb-5 pt-5">
                  <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                    Latest Reflection
                  </h3>
                  <p className="mt-2 text-sm leading-7 text-[color:var(--muted-foreground)]">
                    {selectedReview
                      ? toSummaryPreview(selectedReview.summary, 260)
                      : "No saved reflection exists for the selected week yet."}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-[var(--border)] bg-white">
                <CardContent className="px-5 pb-5 pt-5">
                  <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
                    Goal Movement
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {weeklyStats.goalStatusCounts.length > 0 ? (
                      weeklyStats.goalStatusCounts.map((entry) => (
                        <Badge key={entry.status} tone="muted">
                          {entry.count} {entry.status}
                        </Badge>
                      ))
                    ) : (
                      <Badge>No goal movement recorded</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div>
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
                Active Blockers
              </h2>
              <span
                className={`inline-flex items-center rounded-sm border px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] ${
                  blockerCount > 0
                    ? "border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.06)] text-[var(--signal-error)]"
                    : "border-[var(--border)] bg-[color:var(--instrument-raised)] text-[color:var(--muted-foreground)]"
                }`}
              >
                {blockerCount} flagged
              </span>
            </div>

            <Card className="border-[rgba(239,68,68,0.16)] bg-[rgba(239,68,68,0.03)]">
              <CardContent className="px-5 pb-5 pt-5">
                <div className="flex items-center gap-3">
                  <span className="text-[var(--signal-error)]">!</span>
                  <span className="text-sm font-semibold text-[color:var(--foreground)]">
                    Review completion risk
                  </span>
                </div>
                {weeklyStats.blockedTasks.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {weeklyStats.blockedTasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-[0.8rem] border border-[rgba(220,38,38,0.16)] bg-white/60 px-3 py-2"
                      >
                        <p className="text-sm font-medium text-[color:var(--foreground)]">{task.title}</p>
                        <p className="mt-1 text-sm leading-6 text-[var(--signal-error)]">
                          {task.blockedReason?.trim() || "Blocked with no reason recorded yet."}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-7 text-[color:var(--muted-foreground)]">
                    No blocked tasks are currently active.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

        </div>

        <div className="space-y-6">
          <Card className="border-[var(--border)] bg-white">
            <CardContent className="px-6 pb-6 pt-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
                    Save Reflection
                  </h2>
                  <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                    Write or update the weekly review fields for the selected cycle.
                  </p>
                </div>
                <Badge tone="muted">{formatIsoDate(bounds.weekStart)}</Badge>
              </div>
              <ReviewForm
                key={`${selectedWeekOf}:${selectedReview?.id ?? "new"}`}
                defaultValues={reviewFormDefaults}
              />
            </CardContent>
          </Card>

          <div>
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
                Activity Stream
              </h2>
              <Link href="/review" className="glass-label text-signal-live">
                View All
              </Link>
            </div>
            <Card className="border-[var(--border)] bg-white">
              <CardContent className="px-6 pb-6 pt-6">
                {pastReviews.length > 0 ? (
                  <div className="relative space-y-6 before:absolute before:bottom-2 before:left-4 before:top-2 before:w-px before:bg-[var(--border)]">
                    {pastReviews.slice(0, 4).map((review, index) => (
                      <div key={review.id} className="relative z-10 flex gap-4">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                            index === 0
                              ? "border-[var(--signal-live)] bg-[rgba(34,197,94,0.12)]"
                              : "border-[var(--border)] bg-[color:var(--instrument-raised)]"
                          }`}
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              index === 0 ? "bg-[var(--signal-live)]" : "bg-[color:var(--muted-foreground)]"
                            }`}
                          />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="text-sm font-semibold text-[color:var(--foreground)]">
                              Review updated
                            </div>
                            <div className="text-xs text-[color:var(--muted-foreground)]">
                              {formatDateTime(review.updated_at ?? review.created_at)}
                            </div>
                          </div>
                          <div className="surface-subtle mt-2 p-3 text-xs leading-6 text-[color:var(--muted-foreground)]">
                            {toSummaryPreview(review.summary, 140)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="surface-empty px-4 py-5 text-sm leading-7 text-[color:var(--muted-foreground)]">
                    No saved reviews have been captured yet. Activity entries will appear here once a weekly reflection is saved.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
