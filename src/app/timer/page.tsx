import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { LiveDuration } from "@/components/timer/live-duration";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  formatDurationLabel,
  getCurrentDayWindow,
  getSessionDurationWithinWindowSeconds,
  getTaskSessionDurationSeconds,
  getTaskTotalDurationMap,
} from "@/lib/task-session";
import { formatTimerDateTime } from "@/lib/timer-domain";

import { resolveSessionConflictAction, startTimerAction, stopTimerAction } from "./actions";

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
  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const todayWindow = getCurrentDayWindow(now);
  const nextDayStartIso = new Date(
    new Date(todayWindow.startIso).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();

  const [tasksResult, openSessionsResult, completedSessionsResult, todaySessionsResult] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, status, projects(name)")
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("task_sessions")
        .select(
          "id, task_id, started_at, tasks(id, title, description, status, priority, goals(title), projects(name, slug))",
        )
        .is("ended_at", null)
        .order("started_at", { ascending: false }),
      supabase
        .from("task_sessions")
        .select(
          "id, task_id, started_at, ended_at, duration_seconds, tasks(id, title, projects(name))",
        )
        .not("ended_at", "is", null)
        .order("started_at", { ascending: false })
        .limit(80),
      supabase
        .from("task_sessions")
        .select("id, task_id, started_at, ended_at, duration_seconds, tasks(id, title)")
        .lt("started_at", nextDayStartIso)
        .or(`ended_at.gte.${todayWindow.startIso},ended_at.is.null`)
        .order("started_at", { ascending: false }),
    ]);

  if (tasksResult.error) {
    throw new Error(`Failed to load tasks: ${tasksResult.error.message}`);
  }
  if (openSessionsResult.error) {
    throw new Error(`Failed to load open sessions: ${openSessionsResult.error.message}`);
  }
  if (completedSessionsResult.error) {
    throw new Error(`Failed to load completed sessions: ${completedSessionsResult.error.message}`);
  }
  if (todaySessionsResult.error) {
    throw new Error(`Failed to load today's sessions: ${todaySessionsResult.error.message}`);
  }

  const taskIds = [
    ...new Set([
      ...tasksResult.data.map((task) => task.id),
      ...openSessionsResult.data.map((session) => session.task_id),
      ...completedSessionsResult.data.map((session) => session.tasks?.id).filter(Boolean),
      ...todaySessionsResult.data.map((session) => session.task_id),
    ]),
  ] as string[];
  const taskTotalDurations = await getTaskTotalDurationMap(supabase, taskIds, nowIso);

  const todayTaskDurationMap = todaySessionsResult.data.reduce<
    Record<string, { taskTitle: string; durationSeconds: number }>
  >((totals, session) => {
    const durationSeconds = getSessionDurationWithinWindowSeconds(
      session,
      todayWindow,
      nowIso,
    );
    if (durationSeconds <= 0) {
      return totals;
    }
    const existing = totals[session.task_id];
    totals[session.task_id] = {
      taskTitle: existing?.taskTitle ?? session.tasks?.title ?? "Untitled task",
      durationSeconds: (existing?.durationSeconds ?? 0) + durationSeconds,
    };
    return totals;
  }, {});

  const todayTaskBreakdown = Object.entries(todayTaskDurationMap)
    .map(([taskId, details]) => ({
      taskId,
      taskTitle: details.taskTitle,
      durationSeconds: details.durationSeconds,
    }))
    .sort((left, right) => right.durationSeconds - left.durationSeconds);
  const todayTotalDurationSeconds = todayTaskBreakdown.reduce(
    (sum, row) => sum + row.durationSeconds,
    0,
  );

  const sessionHistory = completedSessionsResult.data
    .map((session) => ({
      id: session.id,
      taskId: session.task_id,
      taskTitle: session.tasks?.title ?? "Untitled task",
      projectName: session.tasks?.projects?.name ?? "Unknown project",
      startedAt: session.started_at,
      endedAt: session.ended_at,
      durationSeconds: getTaskSessionDurationSeconds(session, nowIso),
    }))
    .sort(
      (left, right) =>
        new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
    );

  return {
    tasks: tasksResult.data,
    openSessions: openSessionsResult.data,
    todayTaskBreakdown,
    todayTotalDurationSeconds,
    sessionHistory,
    taskTotalDurations,
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
      <CardContent className="flex min-h-40 flex-col justify-between p-6">
        <p className="glass-label text-etch">{label}</p>
        <p
          className={`text-5xl font-semibold tracking-tight ${
            tone === "active" ? "text-signal-live" : "text-[color:var(--foreground)]"
          }`}
        >
          {value}
        </p>
        <p
          className={`text-sm ${
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
  searchParams: Promise<{ actionError?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const actionError = resolvedSearchParams.actionError?.slice(0, 180) ?? null;
  const {
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
  const sessionControlTaskOptions = tasks.slice(0, 100);

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
          <Link
            href="/review"
            className="btn-instrument btn-instrument-muted flex h-8 items-center px-4"
          >
            Export
          </Link>
        </div>
      }
    >
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

      <div className="grid gap-6 md:grid-cols-3">
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

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="flex h-full flex-col items-center justify-center p-8">
            <p className="glass-label text-etch self-start">Project Allocation</p>
            <div
              className="relative mt-8 flex h-48 w-48 items-center justify-center rounded-full"
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
              <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full bg-[color:var(--instrument)]">
                <span className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
                  {todayTaskBreakdown.length}
                </span>
                <span className="glass-label text-etch">Tasks</span>
              </div>
            </div>

            <div className="mt-8 w-full space-y-3">
              {topBreakdown.length > 0 ? (
                topBreakdown.map((row, index) => (
                  <div key={row.taskId} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-3 w-3 rounded-sm ${
                          index === 0
                            ? "bg-[var(--signal-live)]"
                            : index === 1
                              ? "bg-[rgba(34,197,94,0.4)]"
                              : "bg-[rgba(255,255,255,0.16)]"
                        }`}
                      />
                      <span className="text-[color:var(--foreground)]">{row.taskTitle}</span>
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
                <p className="text-sm text-[color:var(--muted-foreground)]">
                  No project allocation data yet today.
                </p>
              )}
            </div>

            <div className="mt-8 w-full border-t border-[var(--border)] pt-6">
              <p className="glass-label text-signal-live mb-3">Session Control</p>
              {activeSession ? (
                <div className="space-y-4">
                  <div className="surface-subtle p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="accent">Active now</Badge>
                      <Badge tone="muted">
                        {activeSession.tasks?.projects?.name ?? "Unknown project"}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm font-medium text-[color:var(--foreground)]">
                      {activeSession.tasks?.title ?? "Untitled task"}
                    </p>
                    <div className="mt-4">
                      <LiveDuration startedAt={activeSession.started_at} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {activeTaskContextHref ? (
                        <Link
                          href={activeTaskContextHref}
                          className="btn-instrument btn-instrument-muted flex h-8 items-center px-4"
                        >
                          Open Task
                        </Link>
                      ) : null}
                      <form action={stopTimerAction}>
                        <input type="hidden" name="sessionId" value={activeSession.id} />
                        <input type="hidden" name="returnTo" value="/timer" />
                        <Button type="submit" variant="danger" disabled={hasSessionConflict}>
                          Stop Timer
                        </Button>
                      </form>
                    </div>
                  </div>
                </div>
              ) : (
                <form action={startTimerAction} className="space-y-3">
                  <select
                    name="taskId"
                    required
                    disabled={sessionControlTaskOptions.length === 0}
                    className="input-instrument h-10 w-full text-sm"
                  >
                    {sessionControlTaskOptions.length === 0 ? (
                      <option value="">No tasks</option>
                    ) : (
                      sessionControlTaskOptions.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))
                    )}
                  </select>
                  <input type="hidden" name="returnTo" value="/timer" />
                  <Button
                    type="submit"
                    disabled={sessionControlTaskOptions.length === 0 || hasSessionConflict}
                  >
                    Start Session
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-white lg:col-span-2">
          <CardContent className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
                Recent Entries
              </h3>
              <Link href="/tasks" className="glass-label text-signal-live">
                View All
              </Link>
            </div>

            {sessionHistory.length === 0 ? (
              <div className="surface-empty px-4 py-5 text-sm text-[color:var(--muted-foreground)]">
                No completed session entries yet.
              </div>
            ) : (
              <div className="space-y-8">
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
                        {rows.slice(0, 5).map((entry) => (
                          <div
                            key={entry.id}
                            className="flex items-center justify-between rounded-sm border border-transparent px-3 py-3 transition hover:border-[var(--border)] hover:bg-[color:var(--instrument-raised)]"
                          >
                            <div className="flex items-center gap-4">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(34,197,94,0.08)] text-[var(--signal-live)]">
                                <span className="text-sm font-semibold">
                                  {entry.projectName.slice(0, 1).toUpperCase()}
                                </span>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-[color:var(--foreground)]">
                                  {entry.taskTitle}
                                </p>
                                <p className="text-xs text-[color:var(--muted-foreground)]">
                                  {entry.projectName}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
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
      </div>

      {actionError ? (
        <div className="feedback-block feedback-block-error mt-4 px-5 py-3">
          <p className="glass-label text-signal-error">{actionError}</p>
        </div>
      ) : null}
    </AppShell>
  );
}
