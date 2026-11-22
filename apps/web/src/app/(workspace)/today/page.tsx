import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";

import "@/styles/today-workbench.css";

import { clearCompletedFromTodayAction } from "@/app/(workspace)/today/actions";
import {
  saveTodayCheckinAction,
  saveTodayReflectionNoteAction,
} from "@/app/(workspace)/today/checkin-actions";
import {
  addTaskDependencyAction,
  removeTaskDependencyAction,
  updateTaskFieldAction,
  updateTaskFieldDraftAction,
} from "@/app/(workspace)/tasks/actions";
import { TaskDrawerHost } from "@/components/tasks/drawer/task-drawer-host";

import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import {
  ActiveTimerPanel,
  FocusQueuePanel,
  StartHerePanel,
} from "@/components/today/today-cockpit-panels";
import { TodayKpiRow } from "@/components/today/today-kpi-row";
import { TodayOperatorPlan } from "@/components/today/today-operator-plan";
import { MorningStartupPanel } from "@/components/today/morning-startup-panel";
import { TodayTaskCard } from "@/components/today/today-task-card";
import { TodayHeaderActions } from "@/components/today/today-header-actions";
import { DailyCheckinForm } from "@/components/shutdown/daily-checkin-form";
import { ShutdownReflectionForm } from "@/components/shutdown/shutdown-reflection-form";
import { TimerActionFeedback } from "@/components/timer/timer-action-feedback";
import { TimerStopOutcomePrompt } from "@/components/timer/timer-stop-outcome-prompt";
import { TimerSyncStatus } from "@/components/timer/timer-sync-status";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { formatDisplayDate } from "@/lib/presentation-format";
import { isTaskCompletedStatus } from "@/lib/task-domain";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getOperatorSnapshotData } from "@/lib/services/operator-service";
import { getMorningStartupData } from "@/lib/services/morning-startup-service";
import { getWebDailyCheckin } from "@/lib/services/checkin-service";
import { parseStartupRetryIds } from "@/lib/morning-startup";
import { getActiveTimerSession } from "@/lib/services/timer-service";
import { getTaskDrawerDetail } from "@/lib/services/task-service";
import { listTaskSubtasks } from "@/lib/services/subtask-service";
import { listTaskAttachments } from "@/lib/services/attachment-service";
import { getTaskActivity } from "@/lib/services/task-activity-service";
import { getTaskCommentThread } from "@/lib/services/task-comment-service";
import { TASK_SUBTASK_ACTIONS } from "@/lib/task-subtask-actions";
import { TASK_COMMENT_ACTIONS } from "@/lib/task-comment-actions";
import { buildTaskDrawerLink } from "@/lib/task-drawer-url";
import {
  getActiveOperatorProposalData,
  getOperatorProposalData,
} from "@/lib/services/operator-proposal-service";
import { getWorkspaceShellMetrics } from "@/lib/workspace-shell";
import type { TodayPlannerTask } from "@/lib/services/today-planner-service";
import { CalendarCheck2, CheckCircle2, CircleOff, ListChecks } from "lucide-react";

// Today-only typography, self-hosted (see src/app/fonts/README.md): Newsreader
// for the heading and focus anchor, IBM Plex Sans for the workbench body.
const newsreader = localFont({
  src: "../../fonts/newsreader-latin-var.woff2",
  weight: "400 600",
  style: "normal",
  variable: "--tw-font-serif",
  display: "swap",
});

const plexSans = localFont({
  src: "../../fonts/ibm-plex-sans-latin-var.woff2",
  weight: "400 600",
  style: "normal",
  variable: "--tw-font-sans",
  display: "swap",
});

const workbenchClassName = `today-workbench ${newsreader.variable} ${plexSans.variable}`;

export const metadata: Metadata = {
  title: "Today",
  description: "Focus on what matters today. Make progress, one step at a time.",
};

function dedupeTasksById(tasks: TodayPlannerTask[]): TodayPlannerTask[] {
  const byId = new Map<string, TodayPlannerTask>();
  for (const task of tasks) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  return [...byId.values()];
}

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

async function loadOperatorProposal(input: {
  operatorProposalId: string | null;
  planRequested: boolean;
  localDate: string;
}) {
  try {
    if (input.operatorProposalId) {
      return await getOperatorProposalData({ proposalId: input.operatorProposalId });
    }
    if (input.planRequested) {
      return await getActiveOperatorProposalData({ localDate: input.localDate });
    }
  } catch {
    return { data: null, errorMessage: "The approval plan is unavailable." };
  }

  // No plan surface is requested: Today never pays for a proposal read.
  return { data: null, errorMessage: null };
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{
    actionError?: string;
    actionSuccess?: string;
    stoppedTaskId?: string;
    operatorProposalId?: string;
    plan?: string;
    finishDay?: string;
    task?: string;
    taskMode?: string;
    taskUpdateError?: string;
    taskUpdateSuccess?: string;
    taskUpdateTaskId?: string;
    startup?: string;
    startupRetry?: string | string[];
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const actionError = resolvedSearchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = resolvedSearchParams.actionSuccess?.slice(0, 180) ?? null;
  const stoppedTaskId = resolvedSearchParams.stoppedTaskId?.slice(0, 80) ?? null;
  const operatorProposalId = resolvedSearchParams.operatorProposalId?.slice(0, 80) ?? null;
  const planRequested = resolvedSearchParams.plan === "1";
  const finishDayRequested = resolvedSearchParams.finishDay === "1";
  const selectedTaskId = resolvedSearchParams.task?.slice(0, 80) ?? null;
  const taskUpdateError = resolvedSearchParams.taskUpdateError?.slice(0, 180) ?? null;
  const taskUpdateSuccess = resolvedSearchParams.taskUpdateSuccess?.slice(0, 180) ?? null;
  const taskUpdateTaskId = resolvedSearchParams.taskUpdateTaskId?.slice(0, 80) ?? null;
  const startupSkipped = resolvedSearchParams.startup === "skipped";
  const startupRetryIds = parseStartupRetryIds(resolvedSearchParams.startupRetry);

  // Only the canonical plan, identity, and shell metrics are eager. Identity and
  // shell metrics are request-memoized, so the workspace layout, Today, and the
  // operator snapshot share one verification and one metrics query per request.
  const [todayResult, user, shellMetrics] = await Promise.all([
    getOperatorSnapshotData(),
    getCurrentUser(),
    getWorkspaceShellMetrics(),
  ]);

  if (todayResult.errorMessage || !todayResult.data) {
    return (
      <div className={workbenchClassName}>
        <WorkspacePageHeader title="Today" description="Your daily plan." />
        <PlannerErrorState actionError={actionError} />
      </div>
    );
  }

  const snapshot = todayResult.data;

  // Secondary work is contextual: the startup panel is always cheap, the
  // proposal read happens only for an explicit plan surface, and the check-in
  // read happens only after the user opens Finish day.
  const [morningStartup, proposalResult, checkinResult] = await Promise.all([
    getMorningStartupData(snapshot, {
      skipped: startupSkipped,
      retryIds: startupRetryIds,
    }),
    loadOperatorProposal({ operatorProposalId, planRequested, localDate: snapshot.date }),
    finishDayRequested
      ? getWebDailyCheckin({ localDate: snapshot.date, timezone: snapshot.timezone }).catch(
          () => ({ checkin: null, errorMessage: "Check-in is unavailable right now." }),
        )
      : Promise.resolve({ checkin: null, errorMessage: null }),
  ]);

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
  };

  const returnTo = selectedTaskId ? buildTaskDrawerLink("/today", selectedTaskId) : "/today";
  const selectedTaskResult = selectedTaskId
    ? await getTaskDrawerDetail(selectedTaskId)
    : null;
  const selectedTask = selectedTaskResult?.kind === "found" ? selectedTaskResult.task : null;

  let selectedTaskSubtasks: Awaited<ReturnType<typeof listTaskSubtasks>>["data"] = [];
  let selectedTaskActivityPage: Awaited<ReturnType<typeof getTaskActivity>> = {
    items: [],
    hasMore: false,
    errorMessage: null,
  };
  let selectedTaskActivity: Awaited<ReturnType<typeof getTaskActivity>>["items"] = [];
  let selectedTaskComments: Awaited<ReturnType<typeof getTaskCommentThread>> = {
    comments: [],
    mentionCandidates: [],
    errorMessage: null,
  };
  let selectedTaskAttachments: Awaited<ReturnType<typeof listTaskAttachments>> = {
    data: [],
    errorMessage: null,
  };

  if (selectedTaskId) {
    const [subtasksResult, activityPageResult, commentsResult, attachmentsResult] =
      await Promise.all([
        listTaskSubtasks(selectedTaskId),
        getTaskActivity(selectedTaskId, { limit: 8 }),
        getTaskCommentThread(selectedTaskId),
        listTaskAttachments(selectedTaskId),
      ]);

    selectedTaskSubtasks = subtasksResult.data ?? [];
    selectedTaskActivityPage = activityPageResult;
    selectedTaskActivity = activityPageResult.items;
    selectedTaskComments = commentsResult;
    selectedTaskAttachments = attachmentsResult;
  }

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

  // Next is the canonical focus queue, kept compact. Scheduled, due-today, and
  // flexible work that is not already queued stays one collapsed step away so
  // no planned state silently disappears from Today.
  const nextTasks = dedupeTasksById(todayData.focusQueue).filter(
    (task) =>
      task.id !== todayData.startHere?.id &&
      task.status !== "blocked" &&
      !isTaskCompletedStatus(task.status),
  );
  const nextTaskIds = new Set(nextTasks.map((task) => task.id));
  const alsoTodayTasks = dedupeTasksById([
    ...todayData.scheduledBlocks,
    ...dueTodayCarryover,
    ...flexibleTodayActionable,
  ]).filter(
    (task) =>
      !nextTaskIds.has(task.id) &&
      task.id !== todayData.startHere?.id &&
      task.status !== "blocked" &&
      !isTaskCompletedStatus(task.status),
  );

  const allDoneToday =
    allTodayCount > 0 &&
    todayData.summary.plannedCount === 0 &&
    todayData.summary.inProgressCount === 0 &&
    todayData.completed.length > 0;

  // Startup opens only while Today has no plan yet; otherwise it stays one
  // quiet line until the operator chooses it.
  const startupOpen = allTodayCount === 0 && !morningStartup.skipped;
  const activeProposalStatus = proposalResult.data?.status;
  const activeProposal =
    activeProposalStatus === "generated" || activeProposalStatus === "approved"
      ? proposalResult.data
      : null;
  const showOperatorPlan = planRequested || Boolean(activeProposal);
  const finishDayHref = "/today?finishDay=1#finish-day";

  return (
    <>
      <OwnerScopedRealtimeRefresh
        ownerUserId={user?.id ?? null}
        channelPrefix="today"
        tables={["tasks", "task_sessions"]}
        reconcileOnVisibility={false}
      />
      {/* Reconnect/visibility reconciliation for the Now panel's active timer. */}
      <TimerSyncStatus surface="today" ownerUserId={user?.id ?? null} />

      {selectedTaskId ? (
        <TaskDrawerHost
          task={selectedTask}
          loadFailed={selectedTaskResult?.kind === "error"}
          updateFieldAction={updateTaskFieldAction}
          updateDraftAction={updateTaskFieldDraftAction}
          ownerId={user?.id ?? null}
          subtasks={selectedTaskSubtasks}
          attachments={selectedTaskAttachments.data}
          attachmentsError={selectedTaskAttachments.errorMessage}
          activity={selectedTaskActivity}
          activityHasMore={selectedTaskActivityPage.hasMore}
          comments={selectedTaskComments.comments}
          commentMentions={selectedTaskComments.mentionCandidates}
          commentsError={selectedTaskComments.errorMessage}
          commentActions={TASK_COMMENT_ACTIONS}
          subtaskActions={TASK_SUBTASK_ACTIONS}
          updateError={taskUpdateTaskId === selectedTaskId ? taskUpdateError : null}
          updateSuccess={taskUpdateTaskId === selectedTaskId ? taskUpdateSuccess : null}
          addDependencyAction={addTaskDependencyAction}
          removeDependencyAction={removeTaskDependencyAction}
        />
      ) : null}

      <div className={workbenchClassName}>
        <WorkspacePageHeader
          title="Today"
          description={formatDisplayDate(todayData.date, "detail")}
          actions={<TodayHeaderActions ownerKey={user?.id ?? ""} />}
        />

        {showStoppedTaskPrompt ? (
          <TimerStopOutcomePrompt
            taskId={stoppedTaskId ?? ""}
            taskTitle={stoppedTaskTitle}
            returnTo={returnTo}
          />
        ) : null}

        <TimerActionFeedback actionError={actionError} actionSuccess={actionSuccess} />

        {/* Now: the current focus task, the live session, and today's figures. */}
        <section className="tw-stage" aria-label="Now">
          <div className="flex flex-col gap-4">
            <ActiveTimerPanel
              activeTimer={todayData.activeTimer}
              returnTo={returnTo}
              startedAt={activeTimerStartedAt}
            />
            <StartHerePanel
              task={todayData.startHere}
              returnTo={returnTo}
              activeTimerSessionId={activeTimerSessionId}
            />
          </div>
          <TodayKpiRow
            summary={todayData.summary}
            hasActiveTimer={Boolean(todayData.activeTimer)}
            globalOverdueCount={shellMetrics.overdueTaskCount}
            workTargetMinutes={morningStartup.workTargetMinutes}
            workTargetLabel={morningStartup.workTargetLabel}
          />
        </section>

        <div className="workspace-main-rail-grid">
          {/* Left / Main Column: one execution queue and quiet day-closing surfaces. */}
          <div className="tw-canvas tw-main flex flex-col gap-4">
            <details
              className="tw-disclosure"
              data-testid="today-startup-disclosure"
              open={startupOpen}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm font-medium text-[color:var(--ega-text)]">
                <span className="flex items-center gap-2">
                  <CalendarCheck2
                    className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
                    aria-hidden="true"
                  />
                  Daily startup
                </span>
                <Badge tone={morningStartup.isRestDay ? "muted" : "info"}>
                  {morningStartup.skipped ? "Skipped" : morningStartup.workTargetLabel}
                </Badge>
              </summary>
              <div className="pt-3">
                <MorningStartupPanel model={morningStartup} />
              </div>
            </details>

            {allTodayCount === 0 ? (
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <p className="flex items-center gap-2 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                    <CalendarCheck2
                      className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
                      aria-hidden="true"
                    />
                    Nothing planned yet for today. Plan from backlog or create a task.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href="/tasks"
                      className="btn-instrument flex h-8 items-center px-3 text-sm"
                    >
                      + Plan from Backlog
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {allDoneToday ? (
              <Card className="border-[var(--status-healthy-border)] bg-[var(--status-healthy-bg)]">
                <CardContent className="flex items-center gap-3 py-3 text-sm font-medium text-[color:var(--ega-text)]">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[color:var(--status-healthy)]" aria-hidden="true" />
                  <span>All done for today! {todayData.completed.length} {todayData.completed.length === 1 ? "task" : "tasks"} completed.</span>
                </CardContent>
              </Card>
            ) : null}

            <FocusQueuePanel
              tasks={nextTasks}
              returnTo={returnTo}
              activeTimerSessionId={activeTimerSessionId}
              excludeTaskId={todayData.startHere?.id ?? null}
            />

            {alsoTodayTasks.length > 0 ? (
              <details className="tw-disclosure" data-testid="today-also">
                <summary className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm font-medium text-[color:var(--ega-text)]">
                  <span className="flex items-center gap-2">
                    <CalendarCheck2
                      className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
                      aria-hidden="true"
                    />
                    Also today
                  </span>
                  <Badge tone="muted">{alsoTodayTasks.length}</Badge>
                </summary>
                <div className="pt-3">
                  {alsoTodayTasks.map((task) => (
                    <TodayTaskCard
                      key={task.id}
                      task={task}
                      returnTo={returnTo}
                      activeTimerSessionId={activeTimerSessionId}
                    />
                  ))}
                </div>
              </details>
            ) : null}

            {todayData.blocked.length > 0 ? (
              <details className="tw-disclosure" data-testid="today-blocked">
                <summary className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm font-medium text-[color:var(--ega-text)]">
                  <span className="flex items-center gap-2">
                    <CircleOff
                      className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
                      aria-hidden="true"
                    />
                    Blocked
                  </span>
                  <Badge tone="warn">{todayData.blocked.length}</Badge>
                </summary>
                <div className="pt-3">
                  {todayData.blocked.map((task) => (
                    <TodayTaskCard
                      key={task.id}
                      task={task}
                      returnTo={returnTo}
                      activeTimerSessionId={activeTimerSessionId}
                    />
                  ))}
                </div>
              </details>
            ) : null}

            <details className="tw-disclosure" data-testid="today-done">
              <summary className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm font-medium text-[color:var(--ega-text)]">
                <span className="flex items-center gap-2">
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
                    aria-hidden="true"
                  />
                  Done
                </span>
                <Badge tone={todayData.completed.length > 0 ? "success" : "muted"}>
                  {todayData.completed.length}
                </Badge>
              </summary>
              <div className="pt-3">
                {todayData.completed.length > 0 ? (
                  <>
                    {todayData.summary.clearableCompletedCount > 0 ? (
                      <form action={clearCompletedFromTodayAction} className="mb-2 flex justify-end">
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
                    ) : null}
                    {todayData.completed.map((task) => (
                      <TodayTaskCard
                        key={task.id}
                        task={task}
                        returnTo={returnTo}
                        isCompleted
                        activeTimerSessionId={activeTimerSessionId}
                      />
                    ))}
                  </>
                ) : (
                  <p className="py-1 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                    Nothing completed yet today. Finished work collects here.
                  </p>
                )}
              </div>
            </details>

            {finishDayRequested ? (
              <section id="finish-day" aria-label="Finish day" className="flex flex-col gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-[length:var(--text-section)] font-semibold text-[color:var(--ega-text)]">
                    <ListChecks
                      className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
                      aria-hidden="true"
                    />
                    Finish day
                  </h2>
                  <p className="mt-1 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                    Two minutes to close the loop: what moved, what got in the way, and tomorrow&apos;s
                    first move.
                  </p>
                </div>
                {checkinResult.errorMessage ? (
                  <p className="feedback-block feedback-block-warn" role="status">
                    {checkinResult.errorMessage}
                  </p>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardContent className="pt-4">
                      <DailyCheckinForm
                        checkin={checkinResult.checkin}
                        defaultLocalDate={todayData.date}
                        action={saveTodayCheckinAction}
                        returnTo="/today?finishDay=1"
                      />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <ShutdownReflectionForm
                        action={saveTodayReflectionNoteAction}
                        returnTo="/today?finishDay=1"
                      />
                    </CardContent>
                  </Card>
                </div>
              </section>
            ) : (
              <Card data-testid="today-finish-day">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                    Check in and set tomorrow&apos;s first move when you are ready to close the day.
                  </p>
                  <Link
                    href={finishDayHref}
                    className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
                  >
                    Finish day
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right / Rail Column: optional plan, never a permanent block. */}
          <div id="plan" className="tw-canvas tw-rail workspace-secondary-rail">
            {showOperatorPlan ? (
              <TodayOperatorPlan
                tasks={todayData.focusQueue}
                proposal={activeProposal}
                proposalError={planRequested ? proposalResult.errorMessage : null}
                returnTo={returnTo}
              />
            ) : (
              <Card data-testid="today-plan-invite">
                <CardContent className="flex flex-col gap-2 py-3">
                  <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]">
                    Want a second opinion on today&apos;s order?
                  </p>
                  <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                    Build an explainable plan from the current focus lane, then approve it before it
                    changes Today.
                  </p>
                  <Link
                    href="/today?plan=1#plan"
                    className="btn-instrument btn-instrument-muted flex h-8 w-fit items-center px-3 text-sm"
                  >
                    Plan
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
