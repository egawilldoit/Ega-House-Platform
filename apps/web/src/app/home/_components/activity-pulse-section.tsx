import Link from "next/link";
import { Activity, ArrowRight, ChevronRight, Flame } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SESSION_HEATMAP_INTENSITY_STYLES } from "@/components/review/session-heatmap";
import { formatDisplayCount, formatDisplayDuration } from "@/lib/presentation-format";

import type { HomeActivityPulse, HomeActivityPulseDay } from "../_lib/home-activity-pulse";
import { getHomeActivityPulseData } from "../_lib/home-activity-pulse";

/**
 * Home Activity pulse — a compact, secondary view over the canonical Work
 * Activity read model (EGA-662). Rendered inside a Suspense boundary so the
 * primary Now experience never waits on activity analytics, and a failed read
 * degrades to a compact note instead of blanking Home.
 *
 * The full yearly heatmap remains owned by `/work-analytics`; this section
 * links there and renders only the compact summary.
 */

const WEEKS_SHOWN = 12;
const DAYS_PER_WEEK = 7;
const WEEKDAY_LABELS: Record<number, string> = { 1: "Mon", 3: "Wed", 5: "Fri" };

type WeekColumn = Array<HomeActivityPulseDay | null>;

function isActiveDay(day: HomeActivityPulseDay): boolean {
  return day.intensity > 0;
}

function buildWeekColumns(days: HomeActivityPulseDay[]): WeekColumn[] {
  const recent = days.slice(-WEEKS_SHOWN * DAYS_PER_WEEK);
  const columns: WeekColumn[] = [];
  for (let index = 0; index < recent.length; index += 1) {
    const day = recent[index];
    if (!day) continue;
    const weekIndex = Math.floor(index / DAYS_PER_WEEK);
    const weekday = new Date(`${day.date}T12:00:00.000Z`).getUTCDay();
    if (!columns[weekIndex]) columns[weekIndex] = new Array<HomeActivityPulseDay | null>(7).fill(null);
    columns[weekIndex][weekday] = day;
  }
  return columns;
}

function monthLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(
    new Date(`${date}T12:00:00.000Z`),
  );
}

function previousMonthPrefix(monthPrefix: string): string {
  const [year, month] = monthPrefix.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function deriveConsistencyNote(days: HomeActivityPulseDay[], activeDays: number): string | null {
  if (days.length === 0) return null;
  if (activeDays === 0) {
    return "No activity yet this year — start a timer or complete a task to begin.";
  }
  const today = days[days.length - 1]?.date ?? "";
  const monthPrefix = today.slice(0, 7);
  const previousPrefix = previousMonthPrefix(monthPrefix);
  const countActive = (prefix: string) =>
    days.filter((day) => day.date.startsWith(prefix) && isActiveDay(day)).length;
  const current = countActive(monthPrefix);
  const previous = countActive(previousPrefix);
  if (current > previous) return "Keep it up! You're more active than last month.";
  if (current === previous) return "Steady — you're even with last month.";
  return "Lighter than last month — every day counts.";
}

function ActivityGrid({ pulse }: { pulse: HomeActivityPulse }) {
  const columns = buildWeekColumns(pulse.days);
  const activeDays = pulse.days.filter(isActiveDay).length;
  const summary = `Activity pulse for the last 12 weeks: ${activeDays} active days, longest streak ${pulse.longestStreak} days.`;

  return (
    <div>
      <div className="flex gap-1" aria-hidden="true">
        <span className="w-7" />
        {columns.map((week, index) => {
          const firstDay = week.find(Boolean);
          if (!firstDay) return <span key={index} className="w-3" />;
          const previousFirst = index > 0 ? columns[index - 1]?.find(Boolean) : null;
          const showLabel = !previousFirst || monthLabel(firstDay.date) !== monthLabel(previousFirst.date);
          return (
            <span
              key={index}
              className="w-3 overflow-visible whitespace-nowrap text-[10px] leading-none text-[color:var(--ega-text-tertiary)]"
            >
              {showLabel ? monthLabel(firstDay.date) : ""}
            </span>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1" role="img" aria-label={summary}>
        <div className="flex flex-col gap-1" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, weekday) => (
            <span
              key={weekday}
              className="flex h-3 items-center text-[10px] leading-none text-[color:var(--ega-text-tertiary)]"
            >
              {WEEKDAY_LABELS[weekday] ?? ""}
            </span>
          ))}
        </div>
        {columns.map((week, index) => (
          <div key={index} className="flex flex-col gap-1" aria-hidden="true">
            {week.map((day, weekday) =>
              day ? (
                <span
                  key={day.date}
                  className="h-3 w-3 rounded-[3px] border"
                  style={SESSION_HEATMAP_INTENSITY_STYLES[day.intensity]}
                />
              ) : (
                <span key={`empty-${weekday}`} className="h-3 w-3" />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityLegend() {
  return (
    <div className="flex items-center gap-1.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
      <span>Less</span>
      {SESSION_HEATMAP_INTENSITY_STYLES.map((style, index) => (
        <span
          key={index}
          className="h-2.5 w-2.5 rounded-[2px] border"
          style={style}
          aria-hidden="true"
        />
      ))}
      <span>More</span>
    </div>
  );
}

function ActivityPulseCard({ pulse }: { pulse: HomeActivityPulse }) {
  const contributions = pulse.sessionCount + pulse.completedTasks;
  const note = deriveConsistencyNote(pulse.days, pulse.activeDays);

  return (
    <Card level="compact" data-testid="home-activity-pulse">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[length:var(--text-body-lg)] font-semibold text-[color:var(--ega-text)]">
              <Activity className="h-4 w-4 text-[color:var(--ega-text-secondary)]" aria-hidden="true" />
              Activity pulse
            </h3>
            <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              {formatDisplayCount(contributions)} contributions in the last year
            </p>
            <p className="mt-0.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              {pulse.activeDays} active days · {formatDisplayDuration(pulse.trackedSeconds, "minute")} tracked
            </p>
          </div>
          <Link
            href="/work-analytics"
            className="inline-flex shrink-0 items-center gap-1.5 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--status-healthy)] hover:underline"
          >
            <Flame className="h-4 w-4" aria-hidden="true" />
            {pulse.currentStreak}-day streak
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <ActivityGrid pulse={pulse} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ActivityLegend />
          <div className="flex flex-wrap items-center gap-4">
            {note ? (
              <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                {note}
              </p>
            ) : null}
            <Link
              href="/work-analytics"
              className="inline-flex items-center gap-1 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]"
            >
              View activity
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityPulseUnavailable() {
  return (
    <Card level="compact" data-testid="home-activity-pulse-unavailable">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
        <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
          Activity pulse unavailable right now.
        </p>
        <Link
          href="/work-analytics"
          className="inline-flex items-center gap-1 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]"
        >
          View activity
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

/** Suspense fallback mirrors the Activity pulse card geometry. */
export function ActivityPulseSkeleton() {
  return (
    <Card level="compact" data-testid="home-activity-pulse-loading">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-16 w-full" />
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-28" />
        </div>
      </CardContent>
    </Card>
  );
}

export async function ActivityPulseSection() {
  const { data, errorMessage } = await getHomeActivityPulseData();

  if (!data || errorMessage) {
    return <ActivityPulseUnavailable />;
  }

  return <ActivityPulseCard pulse={data} />;
}
