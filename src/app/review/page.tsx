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
  isIsoDate,
  shiftIsoDateByDays,
} from "@/lib/review-week";
import { createClient } from "@/lib/supabase/server";
import {
  getWeeklyReviewPageData,
  type WeeklyReviewPageData,
} from "@/lib/services/weekly-review-page-service";

import { ReviewEmailPreviewForm } from "./review-email-preview-form";
import { ReviewForm } from "./review-form";
import { WeekSelector } from "./week-selector";

export const metadata: Metadata = {
  title: "Review",
  description: "Weekly review reflection workflow.",
};

type ReviewPageProps = { searchParams: Promise<{ draft?: string; weekOf?: string }> };

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
  rows: WeeklyReviewPageData["mostTrackedInsights"][keyof WeeklyReviewPageData["mostTrackedInsights"]];
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
                    {`${row.sessionCount} session${row.sessionCount === 1 ? "" : "s"}`}
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
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("You must be signed in to review weekly activity.");
  }
  const ownerUserId = authData.user.id;
  const shouldUseGeneratedDraft = resolvedSearchParams.draft === "generated";
  const {
    bounds,
    pastReviews,
    selectedReview,
    weeklyStats,
    sessionHeatmap,
    mostTrackedInsights,
    reviewFormDefaults,
  } = await getWeeklyReviewPageData({
    ownerUserId,
    selectedWeekOf,
    useGeneratedDraft: shouldUseGeneratedDraft,
  });

  const cycleVelocity = Math.min(
    100,
    Math.round((weeklyStats.trackedSeconds / (40 * 60 * 60)) * 100),
  );
  const blockerCount = weeklyStats.blockedTasks.length;
  const velocityBand = getVelocityBand(cycleVelocity);
  const sparseHeatmap = sessionHeatmap.filter((entry) => entry.trackedSeconds > 0).length < 5;
  const weekBarData = sessionHeatmap.slice(-7);
  const generatedDraftHref = `/review?weekOf=${selectedWeekOf}&draft=generated`;

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

      <div className="workspace-main-rail-grid mt-6">
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
                    {shouldUseGeneratedDraft || !selectedReview ? "Generated Review Draft" : "Saved Reflection"}
                  </h2>
                  <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                    {selectedReview && !shouldUseGeneratedDraft
                      ? "Saved content is loaded for editing. Regenerate only when you want to replace these fields with activity-derived draft text."
                      : "Activity-derived draft is editable before save and stored in the canonical weekly review record."}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge tone="muted">{formatIsoDate(bounds.weekStart)}</Badge>
                  {selectedReview ? (
                    <Link
                      href={generatedDraftHref}
                      className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center px-3"
                    >
                      Regenerate
                    </Link>
                  ) : null}
                </div>
              </div>
              <ReviewForm
                key={`${selectedWeekOf}:${selectedReview?.id ?? "new"}:${shouldUseGeneratedDraft ? "generated" : "saved"}`}
                defaultValues={reviewFormDefaults}
              />
            </CardContent>
          </Card>

          <Card className="border-[var(--border)] bg-white">
            <CardContent className="px-6 pb-6 pt-6">
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
                    Email Preview
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    Send current saved weekly review through Resend without changing official send state.
                  </p>
                </div>
                <Badge tone="muted">Manual test</Badge>
              </div>
              <ReviewEmailPreviewForm reviewId={selectedReview?.id ?? null} />
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
