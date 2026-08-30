import type { Metadata } from "next";
import Link from "next/link";

import { clearCompletedFromTodayAction } from "@/app/today/actions";
import { AppShell } from "@/components/layout/app-shell";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import {
  ActiveTimerPanel,
  FocusQueuePanel,
  StartHerePanel,
} from "@/components/today/today-cockpit-panels";
import { TodayIntelligencePanel } from "@/components/today/today-intelligence-panel";
import { TodayOperatorPlan } from "@/components/today/today-operator-plan";
import { TodaySection } from "@/components/today/today-section";
import { TodaySuggestionsPanel } from "@/components/today/today-suggestions-panel";
import { TodaySummaryBar } from "@/components/today/today-summary-bar";
import { TodayTaskCard } from "@/components/today/today-task-card";
import { TimerActionFeedback } from "@/components/timer/timer-action-feedback";
import { TimerStopOutcomePrompt } from "@/components/timer/timer-stop-outcome-prompt";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { isTaskCompletedStatus } from "@/lib/task-domain";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getOperatorSnapshotData } from "@/lib/services/operator-service";
import { getHealthSnapshotData } from "@/lib/services/health-snapshot-service";
import { getFrictionRadar } from "@/lib/services/friction-service";
import { getOperatorProposalData } from "@/lib/services/operator-proposal-service";
import { CalendarCheck2, CircleCheck, CircleDashed, CircleOff, CirclePlay } from "lucide-react";

export const metadata: Metadata = {
  title: "Today",
  description: "Plan intentional work for today with direct execution controls.",
};

function PlannerErrorState({ actionError }: { actionError: string | null }) {
  return (
    <div className="space-y-4">
      {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}
      <Card className="border-[var(--border)] bg-white">
        <CardContent className="px-6 pb-6 pt-6">
          <div className="space-y-3" role="status" aria-live="polite">
            <div>
              <h2 className="text-base font-semibold text-[color:var(--foreground)]">Today is temporarily unavailable</h2>
              <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                The daily plan could not be read. Your task inventory is still available while we recover the daily view.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/today" className="btn-instrument inline-flex h-9 items-center px-3">Retry Today</Link>
              <Link href="/tasks" className="btn-instrument btn-instrument-muted inline-flex h-9 items-center px-3">Open Tasks</Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{
    actionError?: string;
    actionSuccess?: string;
    stoppedTaskId?: string;
    operatorProposalId?: string;
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const actionError = resolvedSearchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = resolvedSearchParams.actionSuccess?.slice(0, 180) ?? null;
  const stoppedTaskId = resolvedSearchParams.stoppedTaskId?.slice(0, 80) ?? null;
  const operatorProposalId = resolvedSearchParams.operatorProposalId?.slice(0, 80) ?? null;

  const [todayResult, healthResult, frictionResult, user, proposalResult] = await Promise.all([
    getOperatorSnapshotData(),
    getHealthSnapshotData().catch(() => ({ errorMessage: "Workload evidence is unavailable.", data: null, recommendations: [] })),
    getFrictionRadar().catch(() => ({ errorMessage: "Friction signals are unavailable.", data: null })),
    getCurrentUser(),
    operatorProposalId
      ? getOperatorProposalData({ proposalId: operatorProposalId }).catch(() => ({ data: null, errorMessage: "The approval plan is unavailable." }))
      : Promise.resolve({ data: null, errorMessage: null }),
  ]);

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

  const snapshot = todayResult.data;
  // Map canonical Operator snapshot to the legacy TodayPlannerData shape expected by existing UI.
  // This keeps the web Today surface on shared semantics without forking ranking.
  const allTasksForLookup = [
    ...snapshot.sections.planned,
    ...snapshot.sections.inProgress,
    ...snapshot.sections.blocked,
    ...snapshot.sections.completed,
    ...snapshot.focus.queue,
    ...snapshot.suggestions.pinned,
    ...snapshot.suggestions.inProgress,
  ];
  const activeTaskForTimer = snapshot.activeTimer
    ? allTasksForLookup.find((t) => t.id === snapshot.activeTimer!.taskId) ?? null
    : null;
  const enrichedActiveTimer = snapshot.activeTimer
    ? {
        sessionId: snapshot.activeTimer.sessionId,
        taskId: snapshot.activeTimer.taskId,
        startedAt: "",
        elapsedLabel: "Running now",
        taskTitle: activeTaskForTimer?.title ?? "Active task",
        taskStatus: activeTaskForTimer?.status ?? "in_progress",
        taskPriority: activeTaskForTimer?.priority ?? "medium",
        projectName: activeTaskForTimer?.projectName ?? "Unknown project",
        projectSlug: activeTaskForTimer?.projectSlug ?? null,
        goalTitle: activeTaskForTimer?.goalTitle ?? null,
      }
    : null;
  const todayData = {
    date: snapshot.date,
    startHere: snapshot.focus.startHere,
    focusQueue: snapshot.focus.queue,
    plannedToday: snapshot.plannedToday,
    scheduledBlocks: snapshot.schedule.blocks,
    flexibleTasks: snapshot.schedule.flexible,
    planned: snapshot.sections.planned,
    inProgress: snapshot.sections.inProgress,
    blocked: snapshot.sections.blocked,
    completed: snapshot.sections.completed,
    suggestions: snapshot.suggestions,
    summary: snapshot.summary,
    activeTimer: enrichedActiveTimer,
    signals: snapshot.signals,
  };
  const returnTo = "/today";
  const activeTimerSessionId = todayData.activeTimer?.sessionId ?? null;
  const flexibleTodayActionable = todayData.flexibleTasks.filter(
    (task) => task.status !== "blocked" && !isTaskCompletedStatus(task.status),
  );
  const stoppedTaskTitle = [
    ...todayData.plannedToday,
    ...todayData.planned,
    ...todayData.inProgress,
    ...todayData.blocked,
    ...todayData.completed,
    ...todayData.focusQueue,
    ...todayData.suggestions.pinned,
    ...todayData.suggestions.inProgress,
  ].find((task) => task.id === stoppedTaskId)?.title ?? "this task";
  const showStoppedTaskPrompt = Boolean(!todayData.activeTimer && stoppedTaskId);

  const allTodayCount =
    todayData.summary.plannedCount +
    todayData.summary.inProgressCount +
    todayData.summary.blockedCount +
    todayData.summary.completedCount;

  return (
    <AppShell
      eyebrow="Execution Workspace"
      title="Today / Daily Operator"
      description={`${formatTaskDueDate(todayData.date)} · Here’s what matters today.`}
      contentClassName="today-page-content"
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

      <div className="today-page-stack">
        {showStoppedTaskPrompt ? (
          <TimerStopOutcomePrompt
            taskId={stoppedTaskId ?? ""}
            taskTitle={stoppedTaskTitle}
            returnTo={returnTo}
          />
        ) : null}

        <TimerActionFeedback
          actionError={actionError}
          actionSuccess={actionSuccess}
        />

        <div className="today-operator-brief" aria-label="Daily Operator briefing">
          <div>
            <p className="glass-label text-signal-live">Morning briefing</p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">Here’s what matters today.</h2>
          </div>
          <div className="today-operator-state-strip">
            <span><strong>{formatTaskEstimate(todayData.summary.totalEstimateMinutes) ?? "—"}</strong> planned load</span>
            <span><strong>{todayData.summary.plannedCount + todayData.summary.inProgressCount}</strong> active lane</span>
            <span><strong>{todayData.summary.overdueCount}</strong> overdue</span>
            <span><strong>{todayData.activeTimer ? "Live" : "None"}</strong> timer</span>
            <span><strong>{todayData.summary.completedCount}</strong> completed</span>
          </div>
        </div>

        <TodaySummaryBar
          plannedCount={todayData.summary.plannedCount}
          inProgressCount={todayData.summary.inProgressCount}
          blockedCount={todayData.summary.blockedCount}
          completedCount={todayData.summary.completedCount}
          totalEstimateMinutes={todayData.summary.totalEstimateMinutes}
          trackedTodayLabel={todayData.summary.trackedTodayLabel}
        />

        <div className="today-cockpit-grid">
          <StartHerePanel
            task={todayData.startHere}
            returnTo={returnTo}
            activeTimerSessionId={activeTimerSessionId}
          />
          <div className="today-cockpit-side">
            <ActiveTimerPanel activeTimer={todayData.activeTimer} returnTo={returnTo} />
            <FocusQueuePanel
              tasks={todayData.focusQueue}
              returnTo={returnTo}
              activeTimerSessionId={activeTimerSessionId}
            />
          </div>
        </div>

        <TodayIntelligencePanel health={healthResult} friction={frictionResult} />

        <TodayOperatorPlan
          tasks={todayData.focusQueue}
          proposal={proposalResult.data}
          proposalError={proposalResult.errorMessage}
          returnTo={returnTo}
        />

        <div className="today-work-grid">
          <div className="today-lane-stack">
            {allTodayCount === 0 ? (
              <Card className="border-[var(--border)] bg-white">
                <CardContent className="space-y-3 px-5 pb-5 pt-5 text-center">
                  <EmptyState
                    icon={CalendarCheck2}
                    title="Nothing planned yet for today"
                    description="Add tasks from pinned or in-progress suggestions to create a focused execution lane."
                    action={
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <a href="#pinned-suggestions" className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-xs">
                          Add from pinned
                        </a>
                        <Link href="/tasks" className="btn-instrument flex h-8 items-center px-3 text-xs">
                          Open all tasks
                        </Link>
                      </div>
                    }
                  />
                </CardContent>
              </Card>
            ) : null}

            {allTodayCount > 0 ? (
              <>
                <TodaySection
                  title="Today Timeline"
                  count={todayData.scheduledBlocks.length}
                  tone="muted"
                  emptyState={
                    <EmptyState
                      icon={CircleDashed}
                      title="No scheduled blocks for today"
                      description="Scheduled tasks with time ranges will appear here."
                    />
                  }
                >
                  {todayData.scheduledBlocks.map((task) => (
                    <TodayTaskCard
                      key={task.id}
                      task={task}
                      returnTo={returnTo}
                      isCompleted={isTaskCompletedStatus(task.status)}
                      activeTimerSessionId={activeTimerSessionId}
                      startTimerLabel="Start Focus Session"
                      startTimerReturnTo="/timer"
                    />
                  ))}
                </TodaySection>

                <TodaySection
                  title="Flexible Today backlog"
                  count={flexibleTodayActionable.length}
                  tone="muted"
                  emptyState={
                    <EmptyState
                      icon={CircleDashed}
                      title="No flexible tasks planned for today."
                      description="Unscheduled tasks planned for today will appear here."
                    />
                  }
                >
                  {flexibleTodayActionable.map((task) => (
                    <TodayTaskCard
                      key={task.id}
                      task={task}
                      returnTo={returnTo}
                      activeTimerSessionId={activeTimerSessionId}
                    />
                  ))}
                </TodaySection>

                <TodaySection
                  title="Due today / active"
                  count={todayData.planned.filter((task) => !task.isPlannedForToday).length + todayData.inProgress.filter((task) => !task.isPlannedForToday).length}
                  tone="info"
                  emptyState={
                    <EmptyState
                      icon={CirclePlay}
                      title="No due-today carryover"
                      description="Tasks due today but not manually planned will appear here."
                    />
                  }
                >
                  {[
                    ...todayData.inProgress.filter((task) => !task.isPlannedForToday),
                    ...todayData.planned.filter((task) => !task.isPlannedForToday),
                  ].map((task) => (
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
                    <EmptyState
                      icon={CircleOff}
                      title="No blocked tasks"
                      description="Blocked work will surface here when status is set to blocked."
                    />
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
                  headerActions={todayData.summary.clearableCompletedCount > 0 ? (
                    <form action={clearCompletedFromTodayAction}>
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <PendingSubmitButton
                        type="submit"
                        variant="muted"
                        size="sm"
                        className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-xs"
                        pendingLabel="Clearing..."
                      >
                        Clear completed from Today
                      </PendingSubmitButton>
                    </form>
                  ) : null}
                  emptyState={
                    <EmptyState
                      icon={CircleCheck}
                      title="No completed items yet"
                      description="Completed Today tasks will appear here for quick cleanup."
                    />
                  }
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
              </>
            ) : null}
          </div>

          <div className="today-assist-stack">
            <TodaySuggestionsPanel
              returnTo={returnTo}
              activeTimerSessionId={activeTimerSessionId}
              groups={[
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
              <CardContent className="space-y-3 px-5 pb-5 pt-5">
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
