"use client";

import React, { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { Clock3, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { formatDisplayDuration } from "@/lib/presentation-format";
import {
  buildWorkActivityGrid,
  type WorkActivityGrid,
} from "@/lib/services/work-activity-grid";
import type {
  WorkActivityCalendar,
  WorkActivityDay,
} from "@/lib/services/work-activity-service";
import type { WorkActivityReadModel } from "@/lib/services/work-activity-read-model";
import type { WorkActivityDayDetails } from "@/lib/services/work-activity-data-adapter";

/**
 * Stable intensity scale built from the EGA data-blue token (never a status
 * colour). `color-mix` keeps the scale tied to the token. Levels are absolute
 * (see work-activity-service), so a day never changes colour because a new
 * maximum appeared elsewhere in the year.
 */
const INTENSITY_STYLES: React.CSSProperties[] = [
  {
    background: "var(--ega-surface-subtle)",
    borderColor: "var(--ega-border)",
  },
  {
    background: "color-mix(in srgb, var(--ega-data-blue) 14%, var(--ega-surface))",
    borderColor: "color-mix(in srgb, var(--ega-data-blue) 30%, var(--ega-border))",
  },
  {
    background: "color-mix(in srgb, var(--ega-data-blue) 26%, var(--ega-surface))",
    borderColor: "color-mix(in srgb, var(--ega-data-blue) 45%, var(--ega-border))",
  },
  {
    background: "color-mix(in srgb, var(--ega-data-blue) 42%, var(--ega-surface))",
    borderColor: "color-mix(in srgb, var(--ega-data-blue) 62%, var(--ega-border))",
  },
  {
    background: "color-mix(in srgb, var(--ega-data-blue) 64%, var(--ega-surface))",
    borderColor: "color-mix(in srgb, var(--ega-data-blue) 82%, var(--ega-border))",
  },
];

const LEGEND_LABELS = ["None", "Low", "Medium", "High", "Peak"] as const;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function formatDayDuration(seconds: number): string {
  if (seconds <= 0) return "no activity";
  if (seconds < 60) return "<1m tracked";
  return `${formatDisplayDuration(seconds, "minute")} tracked`;
}

/**
 * Per-day accessible label, e.g.
 * "Sunday, September 27, 2026 — 2h 14m tracked, 3 sessions, 2 Tasks completed."
 */
function formatDayAriaLabel(day: WorkActivityDay): string {
  const date = new Date(`${day.date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const parts = [formatDayDuration(day.trackedSeconds)];
  if (day.sessionCount > 0) {
    parts.push(`${day.sessionCount} session${day.sessionCount !== 1 ? "s" : ""}`);
  }
  if (day.completedTaskCount > 0) {
    parts.push(`${day.completedTaskCount} Task${day.completedTaskCount !== 1 ? "s" : ""} completed`);
  }
  return `${date} — ${parts.join(", ")}.`;
}

function WorkActivitySummary({ calendar }: { calendar: WorkActivityCalendar }) {
  const tracked = formatDisplayDuration(calendar.totalTrackedSeconds, "minute");
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[length:var(--text-meta)] text-ega-text-secondary">
      <div className="flex gap-1.5">
        <dt className="text-ega-text-tertiary">Active days</dt>
        <dd className="font-medium tabular-nums text-ega-text">{calendar.activeDayCount}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-ega-text-tertiary">Current streak</dt>
        <dd className="font-medium tabular-nums text-ega-text">{calendar.currentStreak} days</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-ega-text-tertiary">Longest streak</dt>
        <dd className="font-medium tabular-nums text-ega-text">{calendar.longestStreak} days</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-ega-text-tertiary">Tracked time</dt>
        <dd className="font-medium tabular-nums text-ega-text">{tracked}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-ega-text-tertiary">Tasks completed</dt>
        <dd className="font-medium tabular-nums text-ega-text">{calendar.totalCompletedTasks}</dd>
      </div>
    </dl>
  );
}

type WorkActivityGridProps = {
  grid: WorkActivityGrid;
  onSelectDay: (date: string) => void;
};

function WorkActivityGrid({ grid, onSelectDay }: WorkActivityGridProps) {
  const cellSize = 12;
  const gap = 3;
  const weekColumnWidth = cellSize + gap;

  const monthLabelByWeek = useMemo(() => {
    const map = new Map<number, string>();
    for (const label of grid.monthLabels) {
      if (!map.has(label.weekIndex)) {
        map.set(label.weekIndex, label.label);
      }
    }
    return map;
  }, [grid.monthLabels]);

  return (
    <div className="overflow-x-auto pb-1" role="region" aria-label="Yearly work activity calendar">
      <div style={{ minWidth: grid.weekCount * weekColumnWidth + 28 }}>
        {/* Month labels row */}
        <div
          className="grid mb-1"
          style={{
            gridTemplateColumns: `28px repeat(${grid.weekCount}, ${cellSize}px)`,
            gap: `${gap}px`,
            gridAutoFlow: "column",
          }}
          aria-hidden="true"
        >
          <div />
          {Array.from({ length: grid.weekCount }, (_, weekIndex) => (
            <span
              key={weekIndex}
              className="text-[10px] leading-none text-ega-text-tertiary"
            >
              {monthLabelByWeek.get(weekIndex) ?? ""}
            </span>
          ))}
        </div>

        {/* Weekday labels + day cells */}
        <div className="grid" style={{ gridTemplateColumns: `28px repeat(${grid.weekCount}, ${cellSize}px)`, gap: `${gap}px`, gridTemplateRows: `repeat(7, ${cellSize}px)` }}>
          {/* Weekday label cells: one per row, placed at the start of each row */}
          {Array.from({ length: 7 }, (_, weekday) => (
            <span
              key={weekday}
              className="flex items-center text-[10px] leading-none text-ega-text-tertiary"
              style={{ gridColumn: 1, gridRow: weekday + 1 }}
              aria-hidden="true"
            >
              {weekday % 2 === 1 ? WEEKDAY_LABELS[weekday] : ""}
            </span>
          ))}

          {grid.cells.map((cell) => (
            <button
              key={cell.date}
              type="button"
              onClick={() => onSelectDay(cell.date)}
              aria-label={formatDayAriaLabel(cell.day)}
              title={formatDayAriaLabel(cell.day)}
              className={`h-[12px] w-[12px] rounded-[2px] border outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ega-data-blue focus-visible:ring-offset-1 ${cell.isCurrentDay ? "ring-1 ring-ega-text" : ""}`}
              style={{
                ...INTENSITY_STYLES[cell.day.intensityLevel],
                gridColumn: cell.weekIndex + 2,
                gridRow: cell.weekday + 1,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkActivityLegend() {
  return (
    <div className="flex items-center gap-2 text-[length:var(--text-meta)] text-ega-text-secondary" aria-label="Work activity legend">
      <span>Less</span>
      {LEGEND_LABELS.map((label, index) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span
            className="h-3 w-3 rounded-[2px] border"
            style={INTENSITY_STYLES[index]}
            aria-hidden="true"
          />
          <span className="sr-only">{label}</span>
        </span>
      ))}
      <span>More</span>
      <span className="ml-2 text-ega-text-tertiary">
        Less to more tracked time and completed Tasks
      </span>
    </div>
  );
}

type WorkActivityDayDrawerProps = {
  date: string | null;
  details: WorkActivityDayDetails | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
};

function WorkActivityDayDrawer({ date, details, loading, error, onClose }: WorkActivityDayDrawerProps) {
  const totalSeconds = details?.sessions.reduce(
    (sum, s) => sum + (s.duration_seconds ?? 0),
    0,
  ) ?? 0;

  return (
    <Sheet open={!!date} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        closeLabel="Close day details"
        aria-labelledby="work-activity-day-title"
        className="bg-ega-bg! backdrop-blur-none!"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-ega-divider px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <SheetTitle
                  id="work-activity-day-title"
                  className="font-sans! text-[length:var(--text-panel-title)]! tracking-[var(--tracking-tight)]! text-ega-text!"
                >
                  {date ? new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  }) : "Day details"}
                </SheetTitle>
                <SheetDescription className="mt-1">
                  {details
                    ? `${details.sessions.length} session${details.sessions.length !== 1 ? "s" : ""} · ${formatDisplayDuration(totalSeconds, "minute")} tracked · ${details.completedTasks.length} Task${details.completedTasks.length !== 1 ? "s" : ""} completed`
                    : "Loading day details…"}
                </SheetDescription>
              </div>
              <SheetClose>
                <Button variant="ghost" size="sm" aria-label="Close day details">
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </SheetClose>
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {loading ? (
              <p className="text-[length:var(--text-meta)] text-ega-text-secondary">Loading…</p>
            ) : error ? (
              <EmptyState icon={Clock3} title="Unable to load day details" description={error} />
            ) : details && details.sessions.length === 0 && details.completedTasks.length === 0 ? (
              <EmptyState
                icon={Clock3}
                title="No activity on this day"
                description="No tracked sessions or completed Tasks on this local day."
              />
            ) : (
              <>
                {details && details.sessions.length > 0 && (
                  <section aria-label="Sessions">
                    <h3 className="glass-label mb-2">Sessions</h3>
                    <div className="space-y-3">
                      {details.sessions.map((session, idx) => (
                        <div key={`${session.task_id}-${session.started_at}-${idx}`} className="rounded-[var(--radius-lg)] border border-ega-border bg-ega-surface p-3">
                          <Link
                            href={`/tasks#task-${session.task_id}`}
                            className="text-[length:var(--text-body)] font-medium text-ega-text hover:underline"
                          >
                            {session.tasks?.title ?? "Untitled task"}
                          </Link>
                          <p className="mt-1 text-[length:var(--text-meta)] text-ega-text-secondary tabular-nums">
                            {formatDisplayDuration(session.duration_seconds ?? 0, "second")} tracked
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {details && details.completedTasks.length > 0 && (
                  <section aria-label="Completed tasks">
                    <h3 className="glass-label mb-2">Completed Tasks</h3>
                    <div className="space-y-3">
                      {details.completedTasks.map((task) => (
                        <div key={task.taskId} className="rounded-[var(--radius-lg)] border border-ega-border bg-ega-surface p-3">
                          <Link
                            href={`/tasks#task-${task.taskId}`}
                            className="text-[length:var(--text-body)] font-medium text-ega-text hover:underline"
                          >
                            {task.title}
                          </Link>
                          <p className="mt-1 text-[length:var(--text-meta)] text-ega-text-secondary">
                            Completed {new Date(task.completedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            {task.projectName ? ` · ${task.projectName}` : ""}
                            {task.goalTitle ? ` · ${task.goalTitle}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type WorkActivityHeatmapProps = {
  workActivity: WorkActivityReadModel | null;
  error: string | null;
};

export function WorkActivityHeatmap({ workActivity, error }: WorkActivityHeatmapProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetails, setDayDetails] = useState<WorkActivityDayDetails | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  const calendar = workActivity?.calendar ?? null;
  const grid = useMemo(() => (calendar ? buildWorkActivityGrid(calendar) : null), [calendar]);

  const handleSelectDay = useCallback(async (date: string) => {
    setSelectedDate(date);
    setDayLoading(true);
    setDayError(null);
    setDayDetails(null);
    try {
      const response = await fetch(`/work-activity/day-details?date=${encodeURIComponent(date)}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to load day details.");
      }
      const payload = (await response.json()) as WorkActivityDayDetails;
      setDayDetails({
        sessions: payload.sessions,
        completedTasks: payload.completedTasks,
      });
    } catch (err) {
      setDayError(err instanceof Error ? err.message : "Failed to load day details.");
    } finally {
      setDayLoading(false);
    }
  }, []);

  if (error || !workActivity || !calendar || !grid) {
    return (
      <DashboardSection
        title="Work activity"
        description="Your working days across the last year."
      >
        <div className="surface-empty px-4 py-5 text-[length:var(--text-meta-lg)] leading-[var(--leading-relaxed)] text-ega-text-secondary" role="status">
          {error
            ? "Work activity is unavailable right now. Your tasks and sessions are unaffected."
            : "No work activity yet. Start a timer or complete a Task to build your year."}
        </div>
      </DashboardSection>
    );
  }

  return (
    <DashboardSection
      title="Work activity"
      description="Your working days across the last year."
    >
      <div className="flex flex-col gap-4">
        <WorkActivitySummary calendar={calendar} />
        <WorkActivityGrid grid={grid} onSelectDay={handleSelectDay} />
        <WorkActivityLegend />

        {/* Accessible table fallback for screen readers */}
        <table className="sr-only">
          <caption>Daily work activity for the last year</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Tracked time</th>
              <th scope="col">Sessions</th>
              <th scope="col">Tasks completed</th>
            </tr>
          </thead>
          <tbody>
            {calendar.days.map((day) => (
              <tr key={day.date}>
                <th scope="row">{day.date}</th>
                <td>{formatDisplayDuration(day.trackedSeconds, "minute")}</td>
                <td>{day.sessionCount}</td>
                <td>{day.completedTaskCount}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <WorkActivityDayDrawer
          date={selectedDate}
          details={dayDetails}
          loading={dayLoading}
          error={dayError}
          onClose={() => setSelectedDate(null)}
        />
      </div>
    </DashboardSection>
  );
}
