import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import {
  formatDateTime,
  formatIsoDate,
  getTodayIsoDate,
  getWeekBounds,
  getWeekWindow,
  isIsoDate,
  shiftIsoDateByDays,
} from "@/lib/review-week";
import { createClient } from "@/lib/supabase/server";
import { getTaskSessionDurationSeconds } from "@/lib/task-session";

import { ReviewForm } from "./review-form";
import { StatsCards, type WeeklyStats } from "./stats-cards";
import { WeekSelector } from "./week-selector";

export const metadata: Metadata = {
  title: "Review | EGA House",
  description: "Weekly review reflection workflow.",
};

const PAST_REVIEW_LIMIT = 100;

type ReviewPageProps = { searchParams: Promise<{ weekOf?: string }> };

function toSummaryPreview(summary: string | null, maxLength = 200) {
  const normalized = summary?.trim() ?? "";
  if (!normalized) return "No summary text.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

async function getPastReviews() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("week_reviews").select("id, week_start, week_end, summary, created_at, updated_at").order("week_start", { ascending: false }).limit(PAST_REVIEW_LIMIT);
  if (error) throw new Error(`Failed to load reviews: ${error.message}`);
  return data;
}

async function getSelectedWeekReviews(weekStart: string, weekEnd: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("week_reviews").select("id, summary, created_at, updated_at").eq("week_start", weekStart).eq("week_end", weekEnd).order("updated_at", { ascending: false });
  if (error) throw new Error(`Failed to load selected week reviews: ${error.message}`);
  return data;
}

async function getWeeklyStats(weekStart: string, weekEnd: string): Promise<WeeklyStats> {
  const { startIso, endExclusiveIso } = getWeekWindow(weekStart, weekEnd);
  const nowIso = new Date().toISOString();
  const sessionNowIso = nowIso < endExclusiveIso ? nowIso : endExclusiveIso;
  const supabase = await createClient();
  const [tasksResult, sessionsResult, goalsResult] = await Promise.all([
    supabase.from("tasks").select("id", { count: "exact", head: true }).gte("created_at", startIso).lt("created_at", endExclusiveIso),
    supabase.from("task_sessions").select("id, task_id, started_at, ended_at, duration_seconds").gte("started_at", startIso).lt("started_at", endExclusiveIso),
    supabase.from("goals").select("id, status").gte("updated_at", startIso).lt("updated_at", endExclusiveIso),
  ]);
  if (tasksResult.error) throw new Error(`Failed to load weekly task stats: ${tasksResult.error.message}`);
  if (sessionsResult.error) throw new Error(`Failed to load weekly session stats: ${sessionsResult.error.message}`);
  if (goalsResult.error) throw new Error(`Failed to load weekly goal stats: ${goalsResult.error.message}`);
  const trackedSeconds = (sessionsResult.data ?? []).reduce((total, session) => total + getTaskSessionDurationSeconds(session, sessionNowIso), 0);
  const goalStatusCounts = Array.from((goalsResult.data ?? []).reduce<Map<string, number>>((counts, goal) => { counts.set(goal.status, (counts.get(goal.status) ?? 0) + 1); return counts; }, new Map())).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)).slice(0, 3);
  return { tasksCreated: tasksResult.count ?? 0, sessionsLogged: sessionsResult.data?.length ?? 0, trackedSeconds, goalsTouched: goalsResult.data?.length ?? 0, goalStatusCounts };
}

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedWeekOf = resolvedSearchParams.weekOf && isIsoDate(resolvedSearchParams.weekOf) ? resolvedSearchParams.weekOf : getTodayIsoDate();
  const bounds = getWeekBounds(selectedWeekOf);
  if (!bounds) throw new Error("Failed to resolve selected week.");
  const [pastReviews, selectedWeekReviews, weeklyStats] = await Promise.all([getPastReviews(), getSelectedWeekReviews(bounds.weekStart, bounds.weekEnd), getWeeklyStats(bounds.weekStart, bounds.weekEnd)]);

  return (
    <AppShell
      eyebrow="Review · Weekly Reflection"
      title="Weekly Review"
      description="Capture written reflection, inspect weekly stats, and review prior snapshots."
    >
      {/* ── Stats readout row ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Tasks created", value: weeklyStats.tasksCreated },
          { label: "Sessions logged", value: weeklyStats.sessionsLogged },
          { label: "Goals touched", value: weeklyStats.goalsTouched },
          { label: "Focus time", value: `${Math.round(weeklyStats.trackedSeconds / 60)}m` },
        ].map((stat) => (
          <div key={stat.label} className="instrument-border bg-instrument rounded-sm px-4 py-4">
            <div className="glass-label text-etch mb-2">{stat.label}</div>
            <p className="font-mono tabular text-2xl font-medium" style={{ color: "var(--foreground)" }}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          {/* Reflection card */}
          <Card label="Reflection" title={`Week of ${formatIsoDate(bounds.weekStart)}`}>
            <WeekSelector
              selectedWeekOf={selectedWeekOf}
              weekStart={bounds.weekStart}
              weekEnd={bounds.weekEnd}
              previousWeekOf={shiftIsoDateByDays(selectedWeekOf, -7)}
              nextWeekOf={shiftIsoDateByDays(selectedWeekOf, 7)}
              existingReviewCount={selectedWeekReviews.length}
            />

            {selectedWeekReviews.length > 0 && (
              <div className="mt-4 space-y-2">
                {selectedWeekReviews.slice(0, 2).map((review) => (
                  <div key={review.id} className="instrument-border rounded-sm px-4 py-3" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                      {toSummaryPreview(review.summary, 160)}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="glass-label text-etch">{formatDateTime(review.updated_at ?? review.created_at)}</span>
                      <Link href={`/review/${review.id}`} className="glass-label text-signal-live transition-precise hover:opacity-80">Open →</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5">
              <ReviewForm defaultWeekOf={selectedWeekOf} />
            </div>
          </Card>

          {/* Weekly stats detail */}
          <Card label="Stats" title={`${formatIsoDate(bounds.weekStart)} — ${formatIsoDate(bounds.weekEnd)}`}>
            <StatsCards stats={weeklyStats} />
          </Card>
        </div>

        {/* Past reviews */}
        <Card label="Archive" title="Past reviews">
          {pastReviews.length === 0 ? (
            <div className="py-8 text-center">
              <p className="glass-label text-etch">No reviews saved yet</p>
            </div>
          ) : (
            <div className="max-h-[48rem] space-y-2 overflow-y-auto pr-1">
              {pastReviews.map((review) => (
                <div key={review.id} className="instrument-border rounded-sm px-4 py-3 transition-precise" style={{ background: "transparent" }}>
                  <p className="glass-label text-etch mb-1">{formatIsoDate(review.week_start)} — {formatIsoDate(review.week_end)}</p>
                  <p className="text-xs leading-relaxed truncate" style={{ color: "var(--muted-foreground)" }}>{toSummaryPreview(review.summary, 100)}</p>
                  <div className="flex justify-between items-center mt-2">
                    <span className="glass-label text-etch">{formatDateTime(review.updated_at ?? review.created_at)}</span>
                    <Link href={`/review/${review.id}`} className="glass-label text-signal-live transition-precise hover:opacity-80">View →</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
