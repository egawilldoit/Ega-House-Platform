import Link from "next/link";
import { Clock3, ListChecks, Target, Timer } from "lucide-react";

import { SessionHeatmap } from "@/components/review/session-heatmap";
import { WeekBarChart } from "@/components/review/week-bar-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatIsoDate, shiftIsoDateByDays } from "@/lib/review-week";
import { formatDurationLabel } from "@/lib/task-session";
import { formatTaskToken } from "@/lib/task-domain";
import { ReviewEmailPreviewForm } from "../review-email-preview-form";
import { ReviewForm } from "../review-form";
import { WeekSelector } from "../week-selector";
import { WeeklyIntelligenceSummary } from "@/components/review/weekly-intelligence-summary";
import type { HealthSnapshotServiceResult } from "@/lib/services/health-snapshot-service";
import type { FrictionRadarResponse } from "@ega/contracts/friction";
import type { ReviewPageModel } from "../_lib/review-page-model";

const SPARSE_HEATMAP_ACTIVE_DAY_THRESHOLD = 5;
const ACTIVITY_STREAM_LIMIT = 6;

function toSummaryPreview(summary: string | null, maxLength = 200) {
  const normalized = summary?.trim() ?? "";
  if (!normalized) return "No summary text.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

function MostTrackedList({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; label: string; href: string | null; trackedLabel: string; sessionCount: number; detail: string }[];
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="glass-label">{title}</p>
        <span className="text-[length:var(--text-meta)] tabular-nums text-ega-text-tertiary">
          {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
          No tracked {title.toLowerCase()} in this weekly window yet.
        </p>
      ) : (
        <ul className="rows mt-1">
          {rows.map((row) => (
            <li key={row.id} className="row px-0!">
              <span className="row-main">
                {row.href ? (
                  <Link href={row.href} className="row-title hover:underline">
                    {row.label}
                  </Link>
                ) : (
                  <span className="row-title">{row.label}</span>
                )}
                <span className="row-meta">{row.detail}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[length:var(--text-body)] font-medium tabular-nums text-ega-text">
                  {row.trackedLabel}
                </span>
                <span className="block text-[length:var(--text-meta)] tabular-nums text-ega-text-tertiary">
                  {row.sessionCount} session{row.sessionCount === 1 ? "" : "s"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReviewPageView({
  model,
  health,
  friction,
}: {
  model: ReviewPageModel;
  health?: HealthSnapshotServiceResult;
  friction?: { data: FrictionRadarResponse | null; errorMessage: string | null };
}) {
  const {
    bounds,
    selectedReview,
    pastReviews,
    weeklyStats,
    sessionHeatmap,
    mostTrackedInsights,
    reviewFormDefaults,
    generatedDraft,
  } = model.data;

  const selectedWeekOf = model.weekOf;
  const previousWeekOf = shiftIsoDateByDays(selectedWeekOf, -7);
  const nextWeekOf = shiftIsoDateByDays(selectedWeekOf, 7);
  const generatedDraftHref = `/review?weekOf=${selectedWeekOf}&draft=generated`;

  const shouldUseGeneratedDraft =
    !selectedReview ||
    (reviewFormDefaults.summary === generatedDraft.summary &&
      reviewFormDefaults.wins === generatedDraft.wins &&
      reviewFormDefaults.blockers === generatedDraft.blockers &&
      reviewFormDefaults.nextSteps === generatedDraft.nextSteps);

  const sparseHeatmap =
    sessionHeatmap.filter((entry) => entry.trackedSeconds > 0).length <
    SPARSE_HEATMAP_ACTIVE_DAY_THRESHOLD;
  const weekBarData = sessionHeatmap.slice(-7);

  return (
    <div className="flex flex-col gap-6" data-testid="review-workspace">
      <WeekSelector
        selectedWeekOf={selectedWeekOf}
        weekStart={bounds.weekStart}
        weekEnd={bounds.weekEnd}
        previousWeekOf={previousWeekOf}
        nextWeekOf={nextWeekOf}
        existingReviewCount={selectedReview ? 1 : 0}
      />

      <DashboardSection
        title="Week at a glance"
        description="Focus, sessions, and goal movement inside the selected weekly window."
      >
        <div className="kpi-grid">
          <StatCard
            label="Focused time"
            icon={Clock3}
            value={formatDurationLabel(weeklyStats.trackedSeconds)}
            subtitle={`${weeklyStats.sessionsLogged} sessions logged`}
          />
          <StatCard
            label="Sessions"
            icon={Timer}
            value={weeklyStats.sessionsLogged}
            subtitle="logged this week"
          />
          <StatCard
            label="Tasks created"
            icon={ListChecks}
            value={weeklyStats.tasksCreated}
            subtitle="created this week"
          />
          <StatCard
            label="Goals touched"
            icon={Target}
            value={weeklyStats.goalsTouched}
            subtitle="goals with movement"
          />
        </div>
      </DashboardSection>

      {health && friction ? (
        <DashboardSection
          title="Insights"
          description="Workload and friction signals from this week."
        >
          <WeeklyIntelligenceSummary health={health} friction={friction} />
        </DashboardSection>
      ) : null}

      <div className="workspace-main-rail-grid">
        <div className="flex min-w-0 flex-col gap-4">
          <Card
            label="Reflection"
            title={shouldUseGeneratedDraft ? "Generated review draft" : "Saved review"}
            action={
              <div className="flex items-center gap-2">
                <Badge tone={selectedReview ? "success" : "info"}>
                  {selectedReview ? "Saved" : "Draft only"}
                </Badge>
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
            }
          >
            <CardContent>
              <p className="mb-4 text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                {selectedReview && !shouldUseGeneratedDraft
                  ? "Saved content is loaded for editing. Regenerate only when you want to replace these fields with activity-derived draft text."
                  : "The draft is editable before saving to your weekly review."}
              </p>
              <ReviewForm
                key={`${selectedWeekOf}:${selectedReview?.id ?? "new"}:${shouldUseGeneratedDraft ? "generated" : "saved"}`}
                defaultValues={reviewFormDefaults}
              />
            </CardContent>
          </Card>

          {sparseHeatmap ? (
            <WeekBarChart data={weekBarData} />
          ) : (
            <SessionHeatmap data={sessionHeatmap} />
          )}

          <Card
            label="Signals"
            title="Most tracked this week"
            action={<Badge tone="muted">Task sessions</Badge>}
          >
            <CardContent className="grid gap-5 lg:grid-cols-3">
              <MostTrackedList title="Tasks" rows={mostTrackedInsights.tasks} />
              <MostTrackedList title="Projects" rows={mostTrackedInsights.projects} />
              <MostTrackedList title="Goals" rows={mostTrackedInsights.goals} />
            </CardContent>
          </Card>
        </div>

        <div className="workspace-secondary-rail">
          <Card label="Status" title="Review status">
            <CardContent className="flex flex-col gap-3">
              <dl className="flex flex-col gap-3">
                <div>
                  <dt className="glass-label">Selected week</dt>
                  <dd className="text-[length:var(--text-body)] font-medium tabular-nums text-ega-text">
                    {formatIsoDate(bounds.weekStart)} — {formatIsoDate(bounds.weekEnd)}
                  </dd>
                </div>
                <div>
                  <dt className="glass-label">Saved review</dt>
                  <dd className="text-[length:var(--text-body)] text-ega-text">
                    {selectedReview ? (
                      <>
                        Saved{" "}
                        {formatDateTime(selectedReview.updated_at ?? selectedReview.created_at)}
                      </>
                    ) : (
                      "Not saved yet"
                    )}
                  </dd>
                </div>
              </dl>

              <div>
                <p className="glass-label">Goal movement</p>
                {weeklyStats.goalStatusCounts.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {weeklyStats.goalStatusCounts.map((entry) => (
                      <StatusBadge
                        key={entry.status}
                        status={entry.status}
                        label={`${entry.count} ${formatTaskToken(entry.status)}`}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
                    No goal movement recorded this week.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card label="Email" title="Email Preview">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
                  Send current saved weekly review through Resend without changing official send state.
                </p>
                <Badge tone="muted">Manual test</Badge>
              </div>
              <ReviewEmailPreviewForm reviewId={selectedReview?.id ?? null} />
            </CardContent>
          </Card>

          <Card label="Unfinished" title="Blocked work">
            <CardContent>
              {weeklyStats.blockedTasks.length > 0 ? (
                <ul className="rows">
                  {weeklyStats.blockedTasks.map((task) => (
                    <li key={task.id} className="row px-0!">
                      <span className="row-main">
                        <Link href={`/tasks#task-${task.id}`} className="row-title hover:underline">
                          {task.title}
                        </Link>
                        <span className="row-meta">
                          {task.blockedReason?.trim() || "Blocked with no reason recorded yet."}
                        </span>
                        <span className="text-[length:var(--text-meta)] text-ega-text-tertiary">
                          Updated {formatDateTime(task.updatedAt)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[length:var(--text-meta-lg)] text-ega-text-secondary">
                  No blocked tasks are currently active.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card
        label="History"
        title="Activity Stream"
        action={
          <Badge tone="muted">
            {pastReviews.length} saved review{pastReviews.length === 1 ? "" : "s"}
          </Badge>
        }
      >
        {pastReviews.length > 0 ? (
          <ul className="rows">
            {pastReviews.slice(0, ACTIVITY_STREAM_LIMIT).map((review) => (
              <li key={review.id} className="row">
                <Link href={`/review/${review.id}`} className="row-main">
                  <span className="row-title">
                    {formatIsoDate(review.week_start)} — {formatIsoDate(review.week_end)}
                  </span>
                  <span className="row-meta">{toSummaryPreview(review.summary, 140)}</span>
                </Link>
                <span className="shrink-0 text-[length:var(--text-meta)] tabular-nums text-ega-text-tertiary">
                  {formatDateTime(review.updated_at ?? review.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <CardContent>
            <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
              No saved reviews have been captured yet. Activity entries will appear here once a
              weekly reflection is saved.
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
