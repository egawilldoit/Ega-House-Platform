import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { ActiveTimerDisplay } from "@/components/timer/active-timer-display";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  formatDurationLabel,
  getCurrentDayWindow,
  getSessionDurationWithinWindowSeconds,
  getTaskSessionDurationSeconds,
  getTaskTotalDurationMap,
} from "@/lib/task-session";
import { formatTimerDateTime } from "@/lib/timer-domain";

import { resolveSessionConflictAction, startTimerAction } from "./actions";

export const metadata: Metadata = {
  title: "Timer | EGA House",
  description: "Start and stop focused task sessions.",
};

function getTaskContextHref(taskId: string | null | undefined, projectSlug: string | null | undefined) {
  if (!taskId || !projectSlug) return null;
  return `/tasks/projects/${projectSlug}#task-${taskId}`;
}

async function getTimerData() {
  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const todayWindow = getCurrentDayWindow(now);
  const nextDayStartIso = new Date(new Date(todayWindow.startIso).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const [tasksResult, openSessionsResult, completedSessionsResult, todaySessionsResult] = await Promise.all([
    supabase.from("tasks").select("id, title, status, projects(name)").order("updated_at", { ascending: false }).limit(100),
    supabase.from("task_sessions").select("id, task_id, started_at, tasks(id, title, description, status, priority, goals(title), projects(name, slug))").is("ended_at", null).order("started_at", { ascending: false }),
    supabase.from("task_sessions").select("id, task_id, started_at, ended_at, duration_seconds, tasks(id, title, projects(name))").not("ended_at", "is", null).order("started_at", { ascending: false }).limit(80),
    supabase.from("task_sessions").select("id, task_id, started_at, ended_at, duration_seconds, tasks(id, title)").lt("started_at", nextDayStartIso).or(`ended_at.gte.${todayWindow.startIso},ended_at.is.null`).order("started_at", { ascending: false }),
  ]);

  if (tasksResult.error) throw new Error(`Failed to load tasks: ${tasksResult.error.message}`);
  if (openSessionsResult.error) throw new Error(`Failed to load open sessions: ${openSessionsResult.error.message}`);
  if (completedSessionsResult.error) throw new Error(`Failed to load completed sessions: ${completedSessionsResult.error.message}`);
  if (todaySessionsResult.error) throw new Error(`Failed to load today's sessions: ${todaySessionsResult.error.message}`);

  const taskIds = [...new Set([
    ...tasksResult.data.map((t) => t.id),
    ...openSessionsResult.data.map((s) => s.task_id),
    ...completedSessionsResult.data.map((s) => s.tasks?.id).filter(Boolean),
    ...todaySessionsResult.data.map((s) => s.task_id),
  ])] as string[];
  const taskTotalDurations = await getTaskTotalDurationMap(supabase, taskIds, nowIso);

  const todayTaskDurationMap = todaySessionsResult.data.reduce<Record<string, { taskTitle: string; durationSeconds: number }>>((totals, session) => {
    const durationSeconds = getSessionDurationWithinWindowSeconds(session, todayWindow, nowIso);
    if (durationSeconds <= 0) return totals;
    const existing = totals[session.task_id];
    totals[session.task_id] = { taskTitle: existing?.taskTitle ?? session.tasks?.title ?? "Untitled task", durationSeconds: (existing?.durationSeconds ?? 0) + durationSeconds };
    return totals;
  }, {});

  const todayTaskBreakdown = Object.entries(todayTaskDurationMap)
    .map(([taskId, details]) => ({ taskId, taskTitle: details.taskTitle, durationSeconds: details.durationSeconds }))
    .sort((a, b) => b.durationSeconds - a.durationSeconds);
  const todayTotalDurationSeconds = todayTaskBreakdown.reduce((s, r) => s + r.durationSeconds, 0);

  const historyByTask = completedSessionsResult.data.reduce<Record<string, { taskId: string; taskTitle: string; projectName: string; sessions: Array<{ id: string; startedAt: string; endedAt: string | null; durationSeconds: number }> }>>((groups, session) => {
    const existing = groups[session.task_id];
    const bucket = existing ?? { taskId: session.task_id, taskTitle: session.tasks?.title ?? "Untitled task", projectName: session.tasks?.projects?.name ?? "Unknown project", sessions: [] };
    bucket.sessions.push({ id: session.id, startedAt: session.started_at, endedAt: session.ended_at, durationSeconds: getTaskSessionDurationSeconds(session, nowIso) });
    groups[session.task_id] = bucket;
    return groups;
  }, {});

  const sessionHistoryByTask = Object.values(historyByTask).sort((a, b) => {
    const aDate = a.sessions[0]?.startedAt ?? "";
    const bDate = b.sessions[0]?.startedAt ?? "";
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

  return { tasks: tasksResult.data, openSessions: openSessionsResult.data, todayTaskBreakdown, todayTotalDurationSeconds, sessionHistoryByTask, taskTotalDurations };
}

type TimerPageProps = { searchParams: Promise<{ actionError?: string }> };

export default async function TimerPage({ searchParams }: TimerPageProps) {
  const resolvedSearchParams = await searchParams;
  const actionError = resolvedSearchParams.actionError?.slice(0, 180) ?? null;
  const { tasks, openSessions, todayTaskBreakdown, todayTotalDurationSeconds, sessionHistoryByTask, taskTotalDurations } = await getTimerData();
  const activeSession = openSessions[0] ?? null;
  const recoveredExtraSessionCount = Math.max(0, openSessions.length - 1);
  const hasSessionConflict = recoveredExtraSessionCount > 0;
  const activeTaskContextHref = getTaskContextHref(activeSession?.task_id, activeSession?.tasks?.projects?.slug);

  return (
    <AppShell
      eyebrow="Timer · Focus Session"
      title="Focus Timer"
      description="Run single-task focus sessions with full recovery state."
    >
      {/* ── Conflict warning ────────────────────────────── */}
      {hasSessionConflict && (
        <div className="mb-5 instrument-border rounded-sm px-5 py-4 flex items-center justify-between gap-4" style={{ borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.05)" }}>
          <p className="glass-label text-signal-warn">
            {recoveredExtraSessionCount} extra open session{recoveredExtraSessionCount > 1 ? "s" : ""} detected — timer controls locked.
          </p>
          <form action={resolveSessionConflictAction}>
            <input type="hidden" name="returnTo" value="/timer" />
            <Button type="submit" variant="muted" size="sm">Resolve conflict</Button>
          </form>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">

        {/* ── Active session card ───────────────────────── */}
        <div
          className="instrument-border bg-instrument rounded-sm p-8 flex flex-col justify-between relative overflow-hidden bg-gradient-radial-accent"
          style={{ minHeight: "280px" }}
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="glass-label text-signal-live mb-2">
                {activeSession ? "● Active Session" : "○ No Active Session"}
              </div>
              <h2 className="font-medium text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--foreground)" }}>
                {activeSession?.tasks?.title ?? "Select a task to begin"}
              </h2>
              {activeSession?.tasks?.projects?.name && (
                <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
                  {activeSession.tasks.projects.name}
                  {activeSession.tasks.priority ? ` · Priority ${activeSession.tasks.priority}` : ""}
                </p>
              )}
            </div>

            {activeSession ? (
              <ActiveTimerDisplay
                session={activeSession}
                taskContextHref={activeTaskContextHref}
                hasSessionConflict={hasSessionConflict}
                totalTrackedDurationSeconds={taskTotalDurations[activeSession.task_id] ?? 0}
              />
            ) : (
              <form action={startTimerAction} className="flex gap-2 items-center">
                <select
                  name="taskId"
                  required
                  disabled={tasks.length === 0}
                  className="input-instrument h-8 text-xs px-2.5 min-w-[160px]"
                >
                  {tasks.length === 0 ? (
                    <option value="">No tasks</option>
                  ) : (
                    tasks.map((t) => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))
                  )}
                </select>
                <input type="hidden" name="returnTo" value="/timer" />
                <Button type="submit" disabled={tasks.length === 0 || hasSessionConflict} size="sm">
                  Start Sequence
                </Button>
              </form>
            )}
          </div>

          {/* Large mono clock placeholder — real active display handled by ActiveTimerDisplay */}
          {!activeSession && (
            <div className="font-mono tabular text-7xl font-medium tracking-tighter py-6" style={{ color: "var(--foreground)" }}>
              00:00:00<span className="text-etch text-4xl">.00</span>
            </div>
          )}

          {/* Today total progress bar */}
          <div>
            <div className="flex justify-between glass-label text-etch mb-2">
              <span>Today Progress</span>
              <span>{formatDurationLabel(todayTotalDurationSeconds)}</span>
            </div>
            <div className="progress-flat">
              <div
                className="progress-flat-fill"
                style={{ width: `${Math.min(100, (todayTotalDurationSeconds / (8 * 3600)) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── Today summary ─────────────────────────────── */}
        <div className="space-y-4">
          {/* Readout */}
          <div className="instrument-border bg-instrument rounded-sm px-5 py-4">
            <div className="glass-label text-etch mb-2">Today Total</div>
            <p className="font-mono tabular text-3xl font-medium" style={{ color: "var(--foreground)" }}>
              {formatDurationLabel(todayTotalDurationSeconds)}
            </p>
          </div>

          {todayTaskBreakdown.length > 0 && (
            <Card label="Breakdown" title="Today by task">
              <div className="space-y-2">
                {todayTaskBreakdown.map((row) => (
                  <div key={row.taskId} className="flex items-center justify-between gap-3">
                    <p className="text-xs truncate" style={{ color: "var(--foreground)" }}>{row.taskTitle}</p>
                    <span className="glass-label text-signal-live font-mono tabular flex-shrink-0">
                      {formatDurationLabel(row.durationSeconds)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* ── Session history ───────────────────────────────── */}
      <Card label="History" title="Session history by task" className="mt-6">
        {sessionHistoryByTask.length === 0 ? (
          <div className="py-8 text-center">
            <p className="glass-label text-etch">No completed sessions yet</p>
          </div>
        ) : (
          <table className="instrument-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Project</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Duration</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {sessionHistoryByTask.flatMap((taskHistory) =>
                taskHistory.sessions.slice(0, 5).map((session, idx) => (
                  <tr key={session.id}>
                    {idx === 0 ? (
                      <td rowSpan={Math.min(5, taskHistory.sessions.length)}>
                        <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{taskHistory.taskTitle}</p>
                      </td>
                    ) : null}
                    {idx === 0 ? (
                      <td rowSpan={Math.min(5, taskHistory.sessions.length)}>
                        <span className="glass-label" style={{ color: "var(--muted-foreground)" }}>{taskHistory.projectName}</span>
                      </td>
                    ) : null}
                    <td><span className="glass-label font-mono text-etch">{formatTimerDateTime(session.startedAt)}</span></td>
                    <td><span className="glass-label font-mono text-etch">{session.endedAt ? formatTimerDateTime(session.endedAt) : "—"}</span></td>
                    <td><span className="glass-label font-mono text-signal-live">{formatDurationLabel(session.durationSeconds)}</span></td>
                    {idx === 0 ? (
                      <td rowSpan={Math.min(5, taskHistory.sessions.length)}>
                        <span className="glass-label font-mono text-etch">{formatDurationLabel(taskTotalDurations[taskHistory.taskId] ?? 0)}</span>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Card>

      {actionError && (
        <div className="mt-4 instrument-border rounded-sm px-5 py-3" style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}>
          <p className="glass-label text-signal-error">{actionError}</p>
        </div>
      )}
    </AppShell>
  );
}
