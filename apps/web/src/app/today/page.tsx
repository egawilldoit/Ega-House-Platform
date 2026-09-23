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
import { TodayKpiRow } from "@/components/today/today-kpi-row";
import { TodayLanePanel } from "@/components/today/today-lane-panel";
import { TodayOperatorPlan } from "@/components/today/today-operator-plan";
import { TodaySection } from "@/components/today/today-section";
import { TodaySuggestionsPanel } from "@/components/today/today-suggestions-panel";
import { TodayTaskCard } from "@/components/today/today-task-card";
import { TodayHeaderActions } from "@/components/today/today-header-actions";
import { TimerActionFeedback } from "@/components/timer/timer-action-feedback";
import { TimerStopOutcomePrompt } from "@/components/timer/timer-stop-outcome-prompt";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { formatDisplayDate } from "@/lib/presentation-format";
import { isTaskCompletedStatus } from "@/lib/task-domain";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getOperatorSnapshotData } from "@/lib/services/operator-service";
import { getActiveTimerSession } from "@/lib/services/timer-service";
import { getHealthSnapshotData } from "@/lib/services/health-snapshot-service";
import { getFrictionRadar } from "@/lib/services/friction-service";
import { getOperatorProposalData } from "@/lib/services/operator-proposal-service";
import { getWorkspaceShellMetrics } from "@/lib/workspace-shell";
import { CalendarCheck2, CircleDashed, CircleOff, CirclePlay } from "lucide-react";

export const metadata: Metadata = {
  title: "Today",
  description: "Focus on what matters today. Make progress, one step at a time.",
};

function PlannerErrorState({ actionError }: { actionError: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}
      <Card>
        <CardContent className="flex flex-col gap-3" role="status" aria-live="polite">
          <div>
            <h2 className="text-[length:var(--text-panel-title)] font-semibold">
              Today is temporarily unavailable
            </h2>
            <p className="mt-1 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
              The daily plan could not be read. Your task inventory stays available while the daily
              view recovers.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/today" className="btn-instrument flex h-8 items-center px-3 text-sm">
              Retry Today
            </Link>
            <Link
              href="/tasks"
              className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
            >
              Open Tasks
            </Link>
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

  const [todayResult, healthResult, frictionResult, user, proposalResult, shellMetrics] =
    await Promise.all([
      getOperatorSnapshotData(),
      getHealthSnapshotData().catch(() => ({
        errorMessage: "Workload guidance is unavailable.",
        data: null,
        recommendations: [],
      })),
      getFrictionRadar().catch(() => ({
        errorMessage: "Friction signals are unavailable.",
        data: null,
      })),
      getCurrentUser(),
      operatorProposalId
        ? getOperatorProposalData({ proposalId: operatorProposalId }).catch(() => ({
            data: null,
            errorMessage: "The approval plan is unavailable.",
          }))
        : Promise.resolve({ data: null, errorMessage: null }),
      // Request-memoized and already resolved by AppShell; reusing it keeps the
      // visible "overdue" metric on the same canonical semantics as the sidebar.
      getWorkspaceShellMetrics(),
    ]);

  if (todayResult.errorMessage || !todayResult.data) {
    return (
      <AppShell
        title="Today"
        description="Focus on what matters today. Make progress, one step at a time."
      >
        <PlannerErrorState actionError={actionError} />
      </AppShell>
    );
  }

  const snapshot = todayResult.data;

  // Bounded active-session read, only when the snapshot says a session ran. It
  // supplies startedAt for the live elapsed display; Today never computes timer
  // math itself and never loads the full Timer page model.
  let activeTimerStartedAt: string | null = null;
  if (snapshot.activeTimer) {
    const activeTimerResult = await getActiveTimerSession();
    activeTimerStartedAt = activeTimerResult.data?.startedAt ?? null;
  }

  // Map the canonical Operator snapshot to the shape the Today surfaces expect.
  // This keeps web Today on shared semantics without forking ranking.
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
        startedAt: activeTimerStartedAt ?? "",
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
  const stoppedTaskTitle =
    [
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

  const dueTodayCarryover = [
    ...todayData.inProgress.filter((task) => !task.isPlannedForToday),
    ...todayData.planned.filter((task) => !task.isPlannedForToday),
  ];

  return (
    <AppShell
      title="Today"
      description={`${formatDisplayDate(todayData.date, "detail")} · Focus on what matters today. Make progress, one step at a time.`}
      actions={<TodayHeaderActions />}
    >
      <OwnerScopedRealtimeRefresh
        ownerUserId={user?.id ?? null}
        channelPrefix="today"
        tables={["tasks", "task_sessions"]}
      />

      {showStoppedTaskPrompt ? (
        <TimerStopOutcomePrompt
          taskId={stoppedTaskId ?? ""}
          taskTitle={stoppedTaskTitle}
          returnTo={returnTo}
        />
      ) : null}

      <TimerActionFeedback actionError={actionError} actionSuccess={actionSuccess} />

      <TodayKpiRow
        summary={todayData.summary}
        hasActiveTimer={Boolean(todayData.activeTimer)}
        globalOverdueCount={shellMetrics.overdueTaskCount}
      />

      <div className="workspace-main-rail-grid">
        <div className="flex flex-col gap-4">
          <StartHerePanel
            task={todayData.startHere}
            returnTo={returnTo}
            activeTimerSessionId={activeTimerSessionId}
          />

          <FocusQueuePanel
            tasks={todayData.focusQueue}
            returnTo={returnTo}
            activeTimerSessionId={activeTimerSessionId}
            excludeTaskId={todayData.startHere?.id ?? null}
          />
        </div>

        <div className="workspace-secondary-rail">
          <ActiveTimerPanel
            activeTimer={todayData.activeTimer}
            returnTo={returnTo}
            startedAt={activeTimerStartedAt}
          />

          <TodayLanePanel
            scheduledBlocks={todayData.scheduledBlocks}
            dueTodayCarryover={dueTodayCarryover}
            flexibleTasks={flexibleTodayActionable}
            returnTo={returnTo}
            activeTimerSessionId={activeTimerSessionId}
          />
        </div>
      </div>

      <TodaySection
        title="Completed today"
        count={todayData.completed.length}
        compactWhenEmpty
        headerActions={
          todayData.summary.clearableCompletedCount > 0 ? (
            <form action={clearCompletedFromTodayAction}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <PendingSubmitButton
                type="submit"
                variant="secondary"
                size="sm"
                pendingLabel="Clearing..."
              >
                Clear completed from Today
              </PendingSubmitButton>
            </form>
          ) : null
        }
        emptyState={
          <p className="px-4 py-4 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            Nothing completed yet today. Finished work collects here.
          </p>
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

      <div className="workspace-main-rail-grid">
        <div className="flex flex-col gap-4">
          {allTodayCount === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={CalendarCheck2}
                  title="Nothing planned yet for today"
                  description="Add tasks from pinned or in-progress suggestions to create a focused execution lane."
                  action={
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <a
                        href="#pinned-suggestions"
                        className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
                      >
                        Add from pinned
                      </a>
                      <Link
                        href="/tasks"
                        className="btn-instrument flex h-8 items-center px-3 text-sm"
                      >
                        Open all tasks
                      </Link>
                    </div>
                  }
                />
              </CardContent>
            </Card>
          ) : null}

          <TodaySection
            title="Blocked"
            count={todayData.blocked.length}
            tone="warn"
            compactWhenEmpty
            emptyState={
              <div className="px-4 py-6">
                <EmptyState
                  icon={CircleOff}
                  title="No blocked tasks"
                  description="Blocked work surfaces here when a task status is set to blocked."
                />
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

          <TodayOperatorPlan
            tasks={todayData.focusQueue}
            proposal={proposalResult.data}
            proposalError={proposalResult.errorMessage}
            returnTo={returnTo}
          />
        </div>

        <div className="workspace-secondary-rail">
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

          <TodayIntelligencePanel health={healthResult} friction={frictionResult} />
        </div>
      </div>

      {allTodayCount > 0 ? (
        <div className="workspace-split-grid">
          <TodaySection
            title="Due today / active"
            count={dueTodayCarryover.length}
            tone="info"
            description="Tasks due today that are not part of the manual plan."
            compactWhenEmpty
            emptyState={
              <div className="px-4 py-6">
                <EmptyState
                  icon={CirclePlay}
                  title="No due-today carryover"
                  description="Tasks due today but not manually planned appear here."
                />
              </div>
            }
          >
            {dueTodayCarryover.map((task) => (
              <TodayTaskCard
                key={task.id}
                task={task}
                returnTo={returnTo}
                activeTimerSessionId={activeTimerSessionId}
              />
            ))}
          </TodaySection>

          <TodaySection
            title="Flexible today"
            count={flexibleTodayActionable.length}
            tone="muted"
            description="Unscheduled tasks planned for today."
            compactWhenEmpty
            emptyState={
              <div className="px-4 py-6">
                <EmptyState
                  icon={CircleDashed}
                  title="No flexible tasks planned"
                  description="Unscheduled tasks planned for today appear here."
                />
              </div>
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
        </div>
      ) : null}
    </AppShell>
  );
}
