import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { TimerActionFeedback } from "@/components/timer/timer-action-feedback";
import { LiveDuration } from "@/components/timer/live-duration";
import { SessionTimingEditor } from "@/components/timer/session-timing-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDurationLabel } from "@/lib/task-session";
import { formatTimerDateTime } from "@/lib/timer-domain";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getTimerWorkspaceData } from "@/lib/services/timer-service";

import {
  completeStoppedTaskAction,
  dismissStoppedTaskPromptAction,
  resolveSessionConflictAction,
  startTimerAction,
  stopTimerAction,
  updateSessionTimingAction,
} from "./actions";
import {
  getTimerStartEmptyStateCopy,
  getTimerStartTaskOptions,
} from "./task-selection";

export const metadata: Metadata = {
  title: "Timer | EGA House",
  description: "Start and stop focused task sessions.",
};

function getTaskContextHref(taskId: string | null | undefined, projectSlug: string | null | undefined) {
  if (!taskId || !projectSlug) {
    return null;
  }
  return `/tasks/projects/${projectSlug}#task-${taskId}`;
}

async function getTimerData() {
  const [workspaceData, user] = await Promise.all([
    getTimerWorkspaceData(),
    getCurrentUser(),
  ]);

  return {
    ownerUserId: user?.id ?? null,
    ...workspaceData,
  };
}

function MetricCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "active";
}) {
  return (
    <Card className="border-[var(--border)] bg-white">
      <CardHeader className="pb-3">
        <p className="glass-label text-etch">{label}</p>
      </CardHeader>
      <CardContent className="pt-0">
        <p
          className={`text-4xl font-semibold tracking-tight ${
            tone === "active" ? "text-signal-live" : "text-[color:var(--foreground)]"
          }`}
        >
          {value}
        </p>
        <p
          className={`mt-2 text-sm ${
            tone === "active"
              ? "text-signal-live"
              : "text-[color:var(--muted-foreground)]"
          }`}
        >
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function TimerPage({
  searchParams,
}: {
  searchParams: Promise<{
    actionError?: string;
    actionSuccess?: string;
    stoppedTaskId?: string;
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const actionError = resolvedSearchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = resolvedSearchParams.actionSuccess?.slice(0, 180) ?? null;
  const stoppedTaskId = resolvedSearchParams.stoppedTaskId?.slice(0, 80) ?? null;
  const {
    ownerUserId,
    tasks,
    openSessions,
    todayTaskBreakdown,
    todayTotalDurationSeconds,
    sessionHistory,
    taskTotalDurations,
  } = await getTimerData();
  const activeSession = openSessions[0] ?? null;
  const recoveredExtraSessionCount = Math.max(0, openSessions.length - 1);
  const hasSessionConflict = recoveredExtraSessionCount > 0;
  const activeTaskContextHref = getTaskContextHref(
    activeSession?.task_id,
    activeSession?.tasks?.projects?.slug,
  );
  const trackedTotalSeconds = Object.values(taskTotalDurations).reduce(
    (sum, value) => sum + value,
    0,
  );
  const longestSession = sessionHistory.reduce(
    (longest, session) =>
      session.durationSeconds > longest.durationSeconds ? session : longest,
    sessionHistory[0] ?? null,
  );
  const topBreakdown = todayTaskBreakdown.slice(0, 3);
  const sessionControlTaskOptions = getTimerStartTaskOptions(tasks).slice(0, 100);
  const sessionControlEmptyStateCopy = getTimerStartEmptyStateCopy(tasks.length);
  const stoppedTaskTitle =
    tasks.find((task) => task.id === stoppedTaskId)?.title ?? "this task";
  const showStoppedTaskPrompt = Boolean(!activeSession && stoppedTaskId);

  return (
    <AppShell
      eyebrow="Team Performance"
      title="Time Tracking"
      description="Tracked time, project allocation, and recent session activity."
      actions={
        <div className="flex gap-3">
          <span className="btn-instrument btn-instrument-muted flex h-8 items-center px-4">
            Today
          </span>
          <a
            href="/timer/export"
            className="btn-instrument btn-instrument-muted flex h-8 items-center px-4"
          >
            Export CSV
          </a>
        </div>
      }
    >
      <OwnerScopedRealtimeRefresh
        ownerUserId={ownerUserId}
        channelPrefix="timer"
        tables={["task_sessions"]}
      />

      {hasSessionConflict ? (
        <div className="feedback-block feedback-block-warn mb-5 flex items-center justify-between gap-4 px-5 py-4">
          <p className="glass-label text-signal-warn">
            {recoveredExtraSessionCount} extra open session
            {recoveredExtraSessionCount > 1 ? "s" : ""} detected.
          </p>
          <form action={resolveSessionConflictAction}>
            <input type="hidden" name="returnTo" value="/timer" />
            <Button type="submit" variant="muted" size="sm">
              Resolve
            </Button>
          </form>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Tracked Total"
          value={formatDurationLabel(trackedTotalSeconds)}
          detail="Captured across loaded task sessions"
          tone="active"
        />
        <MetricCard
          label="Today Total"
          value={formatDurationLabel(todayTotalDurationSeconds)}
          detail={
            todayTaskBreakdown.length > 0
              ? `${todayTaskBreakdown.length} task bucket${
                  todayTaskBreakdown.length === 1 ? "" : "s"
                } today`
              : "No sessions captured today"
          }
        />
        <MetricCard
          label="Longest Session"
          value={
            longestSession ? formatDurationLabel(longestSession.durationSeconds) : "--"
          }
          detail={longestSession ? longestSession.taskTitle : "No completed sessions yet"}
        />
      </div>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(21rem,0.82fr)]">
        <Card className="border-[var(--border)] bg-white">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="glass-label text-signal-live">Recent Entries</p>
                <CardTitle className="mt-2 text-xl">Session timeline</CardTitle>
                <CardDescription>
                  Recent completed work grouped by recency, with duration and project context.
                  Use Export CSV to download the full timer session report.
                </CardDescription>
              </div>
              <CardAction>
                <Link href="/tasks" className="glass-label text-signal-live">
                  View Tasks
                </Link>
              </CardAction>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {sessionHistory.length === 0 ? (
              <div className="surface-empty px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
                No completed session entries yet.
              </div>
            ) : (
              <div className="space-y-6">
                {["Today", "Earlier"].map((groupLabel) => {
                  const rows = sessionHistory.filter((entry) => {
                    const started = new Date(entry.startedAt);
                    const now = new Date();
                    const sameDay =
                      started.getFullYear() === now.getFullYear() &&
                      started.getMonth() === now.getMonth() &&
                      started.getDate() === now.getDate();
                    return groupLabel === "Today" ? sameDay : !sameDay;
                  });

                  if (rows.length === 0) {
                    return null;
                  }

                  return (
                    <div key={groupLabel}>
                      <p className="glass-label text-etch mb-3 border-b border-[var(--border)] pb-2">
                        {groupLabel}
                      </p>
                      <div className="space-y-2">
                        {rows.slice(0, 6).map((entry) => (
                          <div
                            key={entry.id}
                            id={`session-${entry.id}`}
                            className="grid gap-3 rounded-[1rem] border border-transparent px-3 py-3 transition hover:border-[var(--border)] hover:bg-[color:var(--instrument-raised)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                          >
                            <div className="flex items-center gap-4">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(34,197,94,0.08)] text-[var(--signal-live)]">
                                <span className="text-sm font-semibold">
                                  {entry.projectName.slice(0, 1).toUpperCase()}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-[color:var(--foreground)]">
                                  {entry.taskTitle}
                                </p>
                                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                                  {entry.projectName}
                                </p>
                              </div>
                            </div>
                            <div className="text-left md:text-right">
                              <p className="text-sm font-medium text-[color:var(--foreground)]">
                                {formatDurationLabel(entry.durationSeconds)}
                              </p>
                              <p className="text-xs text-[color:var(--muted-foreground)]">
                                {formatTimerDateTime(entry.startedAt)}
                                {entry.endedAt
                                  ? ` - ${formatTimerDateTime(entry.endedAt)}`
                                  : ""}
                              </p>
                            </div>
                            <div className="md:col-span-2">
                              <details className="rounded-[0.85rem] border border-[var(--border)] bg-[color:var(--instrument)] px-3 py-2">
                                <summary className="cursor-pointer text-xs uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                                  Correct timing
                                </summary>
                                <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
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
                              </details>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <p className="glass-label text-signal-live">Session Control</p>
              <CardTitle className="text-xl">Focus controls</CardTitle>
              <CardDescription>
                Start, stop, or recover the active session without leaving the timer workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {showStoppedTaskPrompt ? (
                <div className="mb-4 rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
                  <p className="glass-label text-etch">Timer stopped</p>
                  <p className="mt-2 text-sm text-[color:var(--foreground)]">
                    Mark <span className="font-medium">{stoppedTaskTitle}</span> done?
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={completeStoppedTaskAction}>
                      <input type="hidden" name="taskId" value={stoppedTaskId ?? ""} />
                      <input type="hidden" name="returnTo" value="/timer" />
                      <Button type="submit" size="sm">
                        Done
                      </Button>
                    </form>
                    <form action={dismissStoppedTaskPromptAction}>
                      <input type="hidden" name="returnTo" value="/timer" />
                      <Button type="submit" size="sm" variant="muted">
                        Skip
                      </Button>
                    </form>
                  </div>
                </div>
              ) : null}
              {activeSession ? (
                <div className="space-y-4">
                  <div className="surface-subtle p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="accent">Active now</Badge>
                      <Badge tone="muted">
                        {activeSession.tasks?.projects?.name ?? "Unknown project"}
                      </Badge>
                      {activeSession.tasks?.goals?.title ? (
                        <Badge tone="muted">{activeSession.tasks.goals.title}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm font-medium text-[color:var(--foreground)]">
                      {activeSession.tasks?.title ?? "Untitled task"}
                    </p>
                    <div className="mt-4">
                      <LiveDuration startedAt={activeSession.started_at} />
                    </div>
                  </div>
                </div>
              ) : (
                <form action={startTimerAction} className="space-y-3">
                  <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
                    <label htmlFor="taskId" className="glass-label text-etch">
                      Select task
                    </label>
                    <select
                      id="taskId"
                      name="taskId"
                      required
                      disabled={sessionControlTaskOptions.length === 0}
                      className="input-instrument mt-2 h-10 w-full text-sm"
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
                  <Button
                    type="submit"
                    disabled={sessionControlTaskOptions.length === 0 || hasSessionConflict}
                    className="w-full"
                  >
                    Start Session
                  </Button>
                </form>
              )}
            </CardContent>
            {activeSession ? (
              <CardFooter className="flex-wrap justify-between">
                <div className="flex flex-wrap gap-3">
                  {activeTaskContextHref ? (
                    <Link
                      href={activeTaskContextHref}
                      className="btn-instrument btn-instrument-muted flex h-8 items-center px-4"
                    >
                      Open Task
                    </Link>
                  ) : null}
                </div>
                <form action={stopTimerAction}>
                  <input type="hidden" name="sessionId" value={activeSession.id} />
                  <input type="hidden" name="returnTo" value="/timer" />
                  <Button type="submit" variant="danger" disabled={hasSessionConflict}>
                    Stop Timer
                  </Button>
                </form>
              </CardFooter>
            ) : null}
          </Card>

          <Card className="border-[var(--border)] bg-white">
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="glass-label text-etch">Project Allocation</p>
                  <CardTitle className="mt-2 text-xl">Today&apos;s distribution</CardTitle>
                  <CardDescription>
                    A compact view of where focused time is going across today&apos;s task mix.
                  </CardDescription>
                </div>
                <CardAction>
                  <Badge tone="muted">{todayTaskBreakdown.length} tasks</Badge>
                </CardAction>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
                <div className="flex justify-center lg:justify-start">
                  <div
                    className="relative flex h-36 w-36 items-center justify-center rounded-full"
                    style={{
                      background: `conic-gradient(
                        var(--signal-live) 0deg ${
                          todayTotalDurationSeconds > 0 && topBreakdown[0]
                            ? (topBreakdown[0].durationSeconds / todayTotalDurationSeconds) * 360
                            : 0
                        }deg,
                        rgba(34,197,94,0.4) ${
                          todayTotalDurationSeconds > 0 && topBreakdown[0]
                            ? (topBreakdown[0].durationSeconds / todayTotalDurationSeconds) * 360
                            : 0
                        }deg ${
                          todayTotalDurationSeconds > 0 && topBreakdown[1]
                            ? ((topBreakdown[0]?.durationSeconds ?? 0) +
                                topBreakdown[1].durationSeconds) /
                                todayTotalDurationSeconds *
                              360
                            : 0
                        }deg,
                        rgba(228,228,231,0.9) 0deg 360deg
                      )`,
                    }}
                  >
                    <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-[color:var(--instrument)]">
                      <span className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
                        {todayTaskBreakdown.length}
                      </span>
                      <span className="glass-label text-etch">Tasks</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {topBreakdown.length > 0 ? (
                    topBreakdown.map((row, index) => (
                      <div
                        key={row.taskId}
                        className="flex items-center justify-between rounded-[0.95rem] border border-[var(--border)] bg-[color:var(--instrument)] px-3 py-3 text-sm"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-3 w-3 rounded-sm ${
                              index === 0
                                ? "bg-[var(--signal-live)]"
                                : index === 1
                                  ? "bg-[rgba(34,197,94,0.4)]"
                                  : "bg-[rgba(20,32,19,0.18)]"
                            }`}
                          />
                          <span className="truncate text-[color:var(--foreground)]">
                            {row.taskTitle}
                          </span>
                        </div>
                        <span className="font-medium text-[color:var(--foreground)]">
                          {todayTotalDurationSeconds > 0
                            ? `${Math.round(
                                (row.durationSeconds / todayTotalDurationSeconds) * 100,
                              )}%`
                            : "0%"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="surface-empty px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
                      No project allocation data yet today.
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                Allocation is based on time captured within today&apos;s session window.
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>

      <TimerActionFeedback actionError={actionError} actionSuccess={actionSuccess} />
    </AppShell>
  );
}
