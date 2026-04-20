import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { TodaySection } from "@/components/today/today-section";
import { TodaySuggestionsPanel } from "@/components/today/today-suggestions-panel";
import { TodaySummaryBar } from "@/components/today/today-summary-bar";
import { TodayTaskCard } from "@/components/today/today-task-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getTodayPlannerData } from "@/lib/services/today-planner-service";

export const metadata: Metadata = {
  title: "Today | EGA House",
  description: "Plan intentional work for today with direct execution controls.",
};

function PlannerErrorState({ actionError }: { actionError: string | null }) {
  return (
    <div className="space-y-4">
      {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}
      <Card className="border-[var(--border)] bg-white">
        <CardContent className="p-6">
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Could not load Today planner right now. Try again shortly.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ actionError?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const actionError = resolvedSearchParams.actionError?.slice(0, 180) ?? null;

  const [todayResult, user] = await Promise.all([getTodayPlannerData(), getCurrentUser()]);

  if (todayResult.errorMessage || !todayResult.data) {
    return (
      <AppShell
        eyebrow="Execution Workspace"
        title="Today"
        description="Build an intentional plan, then move directly into execution."
      >
        <PlannerErrorState actionError={actionError} />
      </AppShell>
    );
  }

  const todayData = todayResult.data;
  const returnTo = "/today";
  const activeTimerSessionId = todayData.activeTimer?.sessionId ?? null;

  const allTodayCount =
    todayData.summary.plannedCount +
    todayData.summary.inProgressCount +
    todayData.summary.blockedCount +
    todayData.summary.completedCount;

  return (
    <AppShell
      eyebrow="Execution Workspace"
      title="Today"
      description={`${formatTaskDueDate(todayData.date)} · Choose the work that matters, then execute it.`}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/tasks" className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center px-4">
            Open tasks
          </Link>
          <Link href="/timer" className="btn-instrument glass-label flex h-8 items-center px-4">
            Open timer
          </Link>
        </div>
      }
    >
      <OwnerScopedRealtimeRefresh
        ownerUserId={user?.id ?? null}
        channelPrefix="today"
        tables={["tasks", "task_sessions"]}
      />

      <div className="space-y-6">
        {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}

        <TodaySummaryBar
          plannedCount={todayData.summary.plannedCount}
          inProgressCount={todayData.summary.inProgressCount}
          blockedCount={todayData.summary.blockedCount}
          completedCount={todayData.summary.completedCount}
          totalEstimateMinutes={todayData.summary.totalEstimateMinutes}
          trackedTodayLabel={todayData.summary.trackedTodayLabel}
        />

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.24fr)_minmax(22rem,0.76fr)]">
          <div className="space-y-4">
            {allTodayCount === 0 ? (
              <Card className="border-[var(--border)] bg-white">
                <CardContent className="space-y-3 px-5 py-5 text-center">
                  <p className="glass-label text-etch">Nothing planned yet for today.</p>
                  <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                    Add tasks from due today, pinned, or in-progress suggestions to create a focused execution lane.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <a href="#due-today-suggestions" className="btn-instrument btn-instrument-muted flex h-8 items-center px-3">
                      Add from due today
                    </a>
                    <a href="#pinned-suggestions" className="btn-instrument btn-instrument-muted flex h-8 items-center px-3">
                      Add from pinned
                    </a>
                    <Link href="/tasks" className="btn-instrument flex h-8 items-center px-3">
                      Open all tasks
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <TodaySection
              title="Planned"
              count={todayData.planned.length}
              tone="muted"
              emptyState={
                <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  No planned tasks yet.
                </div>
              }
            >
              {todayData.planned.map((task) => (
                <TodayTaskCard
                  key={task.id}
                  task={task}
                  returnTo={returnTo}
                  activeTimerSessionId={activeTimerSessionId}
                />
              ))}
            </TodaySection>

            <TodaySection
              title="In Progress"
              count={todayData.inProgress.length}
              tone="info"
              emptyState={
                <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  No active in-progress tasks in Today.
                </div>
              }
            >
              {todayData.inProgress.map((task) => (
                <TodayTaskCard
                  key={task.id}
                  task={task}
                  returnTo={returnTo}
                  activeTimerSessionId={activeTimerSessionId}
                />
              ))}
            </TodaySection>

            <TodaySection
              title="Blocked"
              count={todayData.blocked.length}
              tone="warn"
              emptyState={
                <div className="surface-empty px-4 py-4 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  No blocked tasks in Today.
                </div>
              }
            >
              {todayData.blocked.map((task) => (
                <TodayTaskCard
                  key={task.id}
                  task={task}
                  returnTo={returnTo}
                  activeTimerSessionId={activeTimerSessionId}
                />
              ))}
            </TodaySection>

            <TodaySection
              title="Completed"
              count={todayData.completed.length}
              tone="success"
              compactWhenEmpty
              emptyState={<div className="text-xs text-[color:var(--muted-foreground)]">No completed Today items yet.</div>}
            >
              {todayData.completed.map((task) => (
                <TodayTaskCard
                  key={task.id}
                  task={task}
                  returnTo={returnTo}
                  isCompleted
                  activeTimerSessionId={activeTimerSessionId}
                />
              ))}
            </TodaySection>
          </div>

          <div className="space-y-4">
            <TodaySuggestionsPanel
              returnTo={returnTo}
              activeTimerSessionId={activeTimerSessionId}
              groups={[
                {
                  key: "due-today",
                  title: "Due today",
                  emptyText: "No tasks are due today.",
                  items: todayData.suggestions.dueToday,
                },
                {
                  key: "pinned",
                  title: "Pinned / focus",
                  emptyText: "No pinned tasks right now.",
                  items: todayData.suggestions.pinned,
                },
                {
                  key: "in-progress",
                  title: "Recently active",
                  emptyText: "No in-progress suggestions right now.",
                  items: todayData.suggestions.inProgress,
                },
              ]}
            />

            <Card className="border-[var(--border)] bg-white">
              <CardContent className="space-y-3 p-4">
                <p className="glass-label text-etch">Today status</p>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="muted">{allTodayCount} in Today</Badge>
                  <Badge tone="info">{todayData.summary.trackedTodayLabel} tracked</Badge>
                </div>
                <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                  Move from planning to execution quickly by starting a timer directly from any Today item.
                </p>
                <Link href="/timer" className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs">
                  Open timer workspace
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
