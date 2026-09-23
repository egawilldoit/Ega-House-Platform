import Link from "next/link";
import { Clock3, Ellipsis } from "lucide-react";

import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { ActiveTimerDisplay } from "@/components/timer/active-timer-display";
import { SessionTimingEditor } from "@/components/timer/session-timing-editor";
import { TimerStopOutcomePrompt } from "@/components/timer/timer-stop-outcome-prompt";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLegend, Metric } from "@/components/ui/metric";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import {
  DISPLAY_EMPTY,
  formatDisplayCount,
  formatDisplayDate,
  formatDisplayDuration,
  formatDisplayPercent,
  formatDisplayTimeRange,
} from "@/lib/presentation-format";
import { resolveSessionConflictAction, startTimerAction, updateSessionTimingAction } from "../actions";
import { getTimerStartEmptyStateCopy, getTimerStartTaskOptions } from "../task-selection";
import type { TimerPageModel } from "../_lib/timer-page-model";

function getTaskContextHref(taskId: string | null | undefined, projectSlug: string | null | undefined) {
  if (!taskId || !projectSlug) return null;
  return `/tasks/projects/${projectSlug}#task-${taskId}`;
}

const DISTRIBUTION_COLORS = [
  "var(--ega-data-blue)",
  "var(--ega-data-orange)",
  "var(--ega-data-purple)",
  "var(--ega-data-green)",
  "var(--ega-data-yellow)",
  "var(--ega-data-slate)",
] as const;

function isSameLocalDay(iso: string) {
  const started = new Date(iso);
  const now = new Date();
  return (
    started.getFullYear() === now.getFullYear() &&
    started.getMonth() === now.getMonth() &&
    started.getDate() === now.getDate()
  );
}

export function TimerPageView({ model }: { model: TimerPageModel }) {
  const {
    stoppedTaskId,
    ownerUserId,
    tasks,
    openSessions,
    todayTaskBreakdown,
    todayTotalDurationSeconds,
    sessionHistory,
    activeSession,
    trackedTotalSeconds,
    taskTotalDurations,
  } = model;

  const recoveredExtraSessionCount = Math.max(0, openSessions.length - 1);
  const hasSessionConflict = recoveredExtraSessionCount > 0;
  const activeTaskContextHref = getTaskContextHref(
    activeSession?.task_id,
    activeSession?.tasks?.projects?.slug,
  );
  const longestSession = sessionHistory.reduce(
    (longest, session) =>
      session.durationSeconds > (longest?.durationSeconds ?? 0) ? session : longest,
    sessionHistory[0] ?? null,
  );
  const topBreakdown = todayTaskBreakdown.slice(0, 6).map((row) => ({
    ...row,
    sharePercent:
      todayTotalDurationSeconds > 0
        ? (row.durationSeconds / todayTotalDurationSeconds) * 100
        : 0,
  }));
  const sessionControlTaskOptions = getTimerStartTaskOptions(tasks).slice(0, 100);
  const sessionControlEmptyStateCopy = getTimerStartEmptyStateCopy(tasks.length);
  const stoppedTaskTitle = tasks.find((task) => task.id === stoppedTaskId)?.title ?? "this task";
  const showStoppedTaskPrompt = Boolean(!activeSession && stoppedTaskId);
  const todayRows = sessionHistory.filter((entry) => isSameLocalDay(entry.startedAt));
  const earlierRows = sessionHistory.filter((entry) => !isSameLocalDay(entry.startedAt));
  const taskTrackedTotalSeconds = activeSession
    ? taskTotalDurations[activeSession.task_id]
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <OwnerScopedRealtimeRefresh
        ownerUserId={ownerUserId}
        channelPrefix="timer"
        tables={["task_sessions"]}
      />

      {hasSessionConflict ? (
        <div className="feedback-block feedback-block-warn justify-between">
          <p>
            {recoveredExtraSessionCount} extra open session
            {recoveredExtraSessionCount > 1 ? "s" : ""} detected. Resolve before starting new work.
          </p>
          <form action={resolveSessionConflictAction}>
            <input type="hidden" name="returnTo" value="/timer" />
            <PendingSubmitButton
              type="submit"
              variant="secondary"
              size="sm"
              pendingLabel="Resolving…"
            >
              Resolve
            </PendingSubmitButton>
          </form>
        </div>
      ) : null}

      {showStoppedTaskPrompt ? (
        <TimerStopOutcomePrompt
          taskId={stoppedTaskId ?? ""}
          taskTitle={stoppedTaskTitle}
          returnTo="/timer"
        />
      ) : null}

      {activeSession ? (
        <Card
          label="Current session"
          title="Focus in progress"
          level="hero"
        >
          <CardContent>
            <ActiveTimerDisplay
              session={activeSession}
              taskContextHref={activeTaskContextHref}
              hasSessionConflict={hasSessionConflict}
              taskTrackedTotalSeconds={taskTrackedTotalSeconds}
            />
          </CardContent>
        </Card>
      ) : (
        <Card
          label="Current session"
          action={<Badge tone="muted">Idle</Badge>}
          level="hero"
        >
          <CardContent className="py-6 sm:py-8">
            <div
              className={
                sessionControlTaskOptions.length > 0
                  ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start"
                  : "max-w-3xl"
              }
            >
              <div className="flex min-w-0 flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <h2 className="text-[length:var(--text-page)] font-semibold leading-[var(--leading-tight)] tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
                    Start a focus session
                  </h2>
                  <p className="max-w-[60ch] text-[length:var(--text-body-lg)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
                    Select a task, then start the timer.
                  </p>
                </div>
                <form action={startTimerAction} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="taskId" className="form-label">
                      Select task
                    </label>
                    <select
                      id="taskId"
                      name="taskId"
                      required
                      disabled={sessionControlTaskOptions.length === 0}
                      className="input-instrument h-8 w-full px-2.5 text-sm"
                    >
                      {sessionControlTaskOptions.length === 0 ? (
                        <option value="">{sessionControlEmptyStateCopy}</option>
                      ) : (
                        sessionControlTaskOptions.map((task) => (
                          <option key={task.id} value={task.id}>
                            {task.title}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <input type="hidden" name="returnTo" value="/timer" />
                  <div className="flex flex-wrap items-center gap-2">
                    <PendingSubmitButton
                      type="submit"
                      disabled={sessionControlTaskOptions.length === 0 || hasSessionConflict}
                      pendingLabel="Starting…"
                    >
                      Start session
                    </PendingSubmitButton>
                    <Link
                      href="/tasks"
                      className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
                    >
                      Open tasks
                    </Link>
                  </div>
                </form>
              </div>

              {sessionControlTaskOptions.length > 0 ? (
                <aside className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] p-4">
                  <p className="glass-label">Ready to track</p>
                  <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                    {`${formatDisplayCount(sessionControlTaskOptions.length)} open task${
                      sessionControlTaskOptions.length === 1 ? "" : "s"
                    } available`}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {sessionControlTaskOptions.slice(0, 3).map((task) => (
                      <li key={task.id} className="min-w-0">
                        <p
                          className="truncate text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]"
                          title={task.title}
                        >
                          {task.title}
                        </p>
                        {task.projects ? (
                          <p className="truncate text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                            {task.projects.name}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </aside>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="kpi-grid">
        <Card label="Tracked total">
          <CardContent>
            <Metric
              label="All loaded sessions"
              value={formatDisplayDuration(trackedTotalSeconds)}
              caption={`${sessionHistory.length} completed session${
                sessionHistory.length === 1 ? "" : "s"
              }`}
            />
          </CardContent>
        </Card>
        <Card label="Today total">
          <CardContent>
            <Metric
              label="Tracked today"
              value={formatDisplayDuration(todayTotalDurationSeconds)}
              caption={
                todayTaskBreakdown.length > 0
                  ? `${formatDisplayCount(todayTaskBreakdown.length)} task${
                      todayTaskBreakdown.length === 1 ? "" : "s"
                    } tracked today`
                  : "No sessions captured today"
              }
            />
          </CardContent>
        </Card>
        <Card label="Longest session">
          <CardContent>
            <Metric
              label="Single session"
              value={longestSession ? formatDisplayDuration(longestSession.durationSeconds) : DISPLAY_EMPTY}
              caption={longestSession ? longestSession.taskTitle : "No completed sessions yet"}
            />
          </CardContent>
        </Card>
      </div>

      <DashboardSection
        title="Today's focus"
        description="Where today's tracked time went, by task."
      >
        <Card>
          {topBreakdown.length === 0 ? (
            <CardContent>
              <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                No time tracked today — start a session to build today&apos;s distribution.
              </p>
            </CardContent>
          ) : (
            <CardContent>
              <div className="workspace-split-grid">
                <div className="flex flex-col gap-3">
                  {topBreakdown.map((row) => {
                    return (
                      <div key={row.taskId} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-[length:var(--text-body)]">
                            {row.taskTitle}
                          </span>
                          <span className="shrink-0 tabular-nums text-[length:var(--text-meta-lg)] font-medium">
                            {formatDisplayDuration(row.durationSeconds)}
                          </span>
                        </div>
                        <div className="progress-track" aria-hidden="true">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${Math.round(row.sharePercent)}%`,
                              background: "var(--ega-data-blue)",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <DataLegend
                  items={topBreakdown.map((row, index) => ({
                    label: row.taskTitle,
                    value: formatDisplayPercent(row.sharePercent),
                    color: DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length],
                  }))}
                />
              </div>
            </CardContent>
          )}
        </Card>
      </DashboardSection>

      <DashboardSection
        title="Recent sessions"
        description="Review recent sessions or correct their timing."
      >
        <Card>
          {sessionHistory.length === 0 ? (
            <CardContent>
              <EmptyState
                icon={Clock3}
                title="No completed sessions yet"
                description="Start a timer from a task to begin building session history."
              />
            </CardContent>
          ) : (
            [
              { label: "Today", rows: todayRows },
              { label: "Earlier", rows: earlierRows },
            ]
              .filter((group) => group.rows.length > 0)
              .map((group) => (
                <div key={group.label}>
                  <div className="flex items-center border-b border-[var(--ega-divider)] px-[18px] py-2.5">
                    <p className="glass-label">{group.label}</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="data-table table-fixed max-[761px]:block min-[761px]:min-w-[46rem]">
                      <thead className="max-[761px]:hidden">
                        <tr>
                          <th scope="col">Task</th>
                          <th scope="col" className="w-[9rem]">
                            Project
                          </th>
                          <th scope="col" className="w-[12rem]">
                            Date / Time
                          </th>
                          <th scope="col" className="w-[7rem] text-right">
                            Duration
                          </th>
                          <th scope="col" className="w-[5rem] text-right">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="max-[761px]:block">
                        {group.rows.slice(0, 8).map((entry) => (
                          <tr
                            key={entry.id}
                            id={`session-${entry.id}`}
                            className="scroll-mt-24 max-[761px]:flex max-[761px]:flex-col max-[761px]:gap-2 max-[761px]:border-b max-[761px]:border-[var(--ega-divider)] max-[761px]:px-3.5 max-[761px]:py-3 max-[761px]:last:border-b-0"
                          >
                            <td className="max-[761px]:contents">
                              <div className="row-main">
                                <span className="row-title" title={entry.taskTitle}>
                                  {entry.taskTitle}
                                </span>
                                <span className="min-[761px]:hidden text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                                  {entry.projectName} ·{" "}
                                  {formatDisplayDate(entry.startedAt, "compact")} ·{" "}
                                  {formatDisplayTimeRange(entry.startedAt, entry.endedAt)}
                                </span>
                              </div>
                            </td>
                            <td className="max-[761px]:hidden">
                              <span className="block truncate text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                                {entry.projectName}
                              </span>
                            </td>
                            <td className="max-[761px]:hidden whitespace-nowrap">
                              <span className="tabular-nums text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]">
                                {formatDisplayDate(entry.startedAt, "compact")}
                              </span>
                              <span className="ml-2 tabular-nums text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                                {formatDisplayTimeRange(entry.startedAt, entry.endedAt)}
                              </span>
                            </td>
                            <td className="numeric max-[761px]:hidden text-right text-[length:var(--text-body)] font-semibold">
                              {formatDisplayDuration(entry.durationSeconds, "second")}
                            </td>
                            <td className="max-[761px]:contents">
                              <div className="flex items-center justify-end gap-1.5">
                                <details className="action-overflow">
                                  <summary
                                    className="filter-pill h-7 w-7 justify-center px-0"
                                    aria-label="Correct session timing"
                                    title="Correct session timing"
                                  >
                                    <Ellipsis className="h-4 w-4" aria-hidden="true" />
                                  </summary>
                                  <div className="action-overflow-menu w-full max-w-md">
                                    <p className="row-meta mb-2">
                                      Adjust the actual time worked for this session.
                                    </p>
                                    {entry.endedAt ? (
                                      <SessionTimingEditor
                                        sessionId={entry.id}
                                        startedAt={entry.startedAt}
                                        endedAt={entry.endedAt}
                                        returnTo="/timer"
                                        action={updateSessionTimingAction}
                                      />
                                    ) : null}
                                  </div>
                                </details>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )))}
        </Card>
      </DashboardSection>
    </div>
  );
}
