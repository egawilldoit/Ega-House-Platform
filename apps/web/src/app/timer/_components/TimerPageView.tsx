import Link from "next/link";

import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { ActiveTimerDisplay } from "@/components/timer/active-timer-display";
import { TimerStopForm } from "@/components/timer/timer-stop-form";
import { SessionTimingEditor } from "@/components/timer/session-timing-editor";
import { TimerStopOutcomePrompt } from "@/components/timer/timer-stop-outcome-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLegend, Metric } from "@/components/ui/metric";
import { formatDurationLabel } from "@/lib/task-session";
import { formatTimerDateTime } from "@/lib/timer-domain";
import { resolveSessionConflictAction, startTimerAction, updateSessionTimingAction } from "../actions";
import { getTimerStartEmptyStateCopy, getTimerStartTaskOptions } from "../task-selection";
import { Clock3 } from "lucide-react";
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
  const topBreakdown = todayTaskBreakdown.slice(0, 6);
  const sessionControlTaskOptions = getTimerStartTaskOptions(tasks).slice(0, 100);
  const sessionControlEmptyStateCopy = getTimerStartEmptyStateCopy(tasks.length);
  const stoppedTaskTitle = tasks.find((task) => task.id === stoppedTaskId)?.title ?? "this task";
  const showStoppedTaskPrompt = Boolean(!activeSession && stoppedTaskId);
  const todayRows = sessionHistory.filter((entry) => isSameLocalDay(entry.startedAt));
  const earlierRows = sessionHistory.filter((entry) => !isSameLocalDay(entry.startedAt));

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
            <Button type="submit" variant="secondary" size="sm">
              Resolve
            </Button>
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

      <Card
        label="Current session"
        title={activeSession ? "Focus in progress" : "Start a focus session"}
        action={
          activeSession ? null : <Badge tone="muted">Idle</Badge>
        }
      >
        <CardContent>
          {activeSession ? (
            <ActiveTimerDisplay
              session={activeSession}
              taskContextHref={activeTaskContextHref}
              hasSessionConflict={hasSessionConflict}
              totalTrackedDurationSeconds={trackedTotalSeconds}
            />
          ) : (
            <form action={startTimerAction} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="taskId" className="glass-label">
                  Select task
                </label>
                <select
                  id="taskId"
                  name="taskId"
                  required
                  disabled={sessionControlTaskOptions.length === 0}
                  className="input-instrument h-8 w-full max-w-xl px-2.5 text-sm"
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
                <Button
                  type="submit"
                  disabled={sessionControlTaskOptions.length === 0 || hasSessionConflict}
                >
                  Start session
                </Button>
                <Link
                  href="/tasks"
                  className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
                >
                  Open tasks
                </Link>
              </div>
            </form>
          )}
        </CardContent>
        {activeSession ? (
          <CardFooter className="justify-end">
            <TimerStopForm
              sessionId={activeSession.id}
              returnTo="/timer"
              disabled={hasSessionConflict}
            />
          </CardFooter>
        ) : null}
      </Card>

      <div className="kpi-grid">
        <Card label="Tracked total">
          <CardContent>
            <Metric
              label="All loaded sessions"
              value={formatDurationLabel(trackedTotalSeconds)}
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
              value={formatDurationLabel(todayTotalDurationSeconds)}
              caption={
                todayTaskBreakdown.length > 0
                  ? `${todayTaskBreakdown.length} task bucket${
                      todayTaskBreakdown.length === 1 ? "" : "s"
                    } today`
                  : "No sessions captured today"
              }
            />
          </CardContent>
        </Card>
        <Card label="Longest session">
          <CardContent>
            <Metric
              label="Single session"
              value={longestSession ? formatDurationLabel(longestSession.durationSeconds) : "—"}
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
              <EmptyState
                icon={Clock3}
                title="No time tracked today"
                description="Start a session from a task and today's distribution will build itself."
              />
            </CardContent>
          ) : (
            <CardContent>
              <div className="workspace-split-grid">
                <div className="flex flex-col gap-3">
                  {topBreakdown.map((row) => {
                    const percent =
                      todayTotalDurationSeconds > 0
                        ? Math.round((row.durationSeconds / todayTotalDurationSeconds) * 100)
                        : 0;
                    return (
                      <div key={row.taskId} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-[length:var(--text-body)]">
                            {row.taskTitle}
                          </span>
                          <span className="shrink-0 tabular-nums text-[length:var(--text-meta-lg)] font-medium">
                            {formatDurationLabel(row.durationSeconds)}
                          </span>
                        </div>
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${percent}%`,
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
                    value:
                      todayTotalDurationSeconds > 0
                        ? `${Math.round((row.durationSeconds / todayTotalDurationSeconds) * 100)}%`
                        : "0%",
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
        description="Completed sessions with the canonical timing correction editor."
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
            <>
              {[
                { label: "Today", rows: todayRows },
                { label: "Earlier", rows: earlierRows },
              ]
                .filter((group) => group.rows.length > 0)
                .map((group) => (
                  <div key={group.label}>
                    <CardHeader className="!py-2.5">
                      <p className="glass-label">{group.label}</p>
                    </CardHeader>
                    <ul className="rows">
                      {group.rows.slice(0, 8).map((entry) => (
                        <li
                          key={entry.id}
                          id={`session-${entry.id}`}
                          className="task-row scroll-mt-24"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="row-title">{entry.taskTitle}</p>
                              <p className="row-meta">{entry.projectName}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="tabular-nums text-[length:var(--text-body)] font-semibold">
                                {formatDurationLabel(entry.durationSeconds)}
                              </span>
                              <span className="tabular-nums text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                                {formatTimerDateTime(entry.startedAt)}
                                {entry.endedAt ? ` – ${formatTimerDateTime(entry.endedAt)}` : ""}
                              </span>
                            </div>
                          </div>
                          <details className="action-overflow">
                            <summary className="filter-pill">Correct timing</summary>
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
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </>
          )}
        </Card>
      </DashboardSection>
    </div>
  );
}
