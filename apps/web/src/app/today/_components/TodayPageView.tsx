import Link from "next/link";
import { clearCompletedFromTodayAction } from "@/app/today/actions";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { ActiveTimerPanel, FocusQueuePanel, StartHerePanel } from "@/components/today/today-cockpit-panels";
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
import { isTaskCompletedStatus } from "@/lib/task-domain";
import { CalendarCheck2, CircleCheck, CircleDashed, CircleOff, CirclePlay } from "lucide-react";
import type { TodayPageModel } from "../_lib/today-page-model";

export function TodayPageView({ model }: { model: TodayPageModel }) {
  const { actionError, actionSuccess, stoppedTaskId, stoppedTaskTitle, showStoppedTaskPrompt, todayData, returnTo, activeTimerSessionId, flexibleTodayActionable, allTodayCount, user } = model;
  if (!todayData) return null;
  return (
    <>
      <OwnerScopedRealtimeRefresh ownerUserId={user?.id ?? null} channelPrefix="today" tables={["tasks", "task_sessions"]} />
      <div className="today-page-stack">
        {showStoppedTaskPrompt ? <TimerStopOutcomePrompt taskId={stoppedTaskId ?? ""} taskTitle={stoppedTaskTitle ?? "this task"} returnTo={returnTo} /> : null}
        <TimerActionFeedback actionError={actionError} actionSuccess={actionSuccess} />
        <TodaySummaryBar plannedCount={todayData.summary.plannedCount} inProgressCount={todayData.summary.inProgressCount} blockedCount={todayData.summary.blockedCount} completedCount={todayData.summary.completedCount} totalEstimateMinutes={todayData.summary.totalEstimateMinutes} trackedTodayLabel={todayData.summary.trackedTodayLabel} />
        <div className="today-cockpit-grid">
          <StartHerePanel task={todayData.startHere} returnTo={returnTo} activeTimerSessionId={activeTimerSessionId} />
          <div className="today-cockpit-side">
            <ActiveTimerPanel activeTimer={todayData.activeTimer} returnTo={returnTo} />
            <FocusQueuePanel tasks={todayData.focusQueue} returnTo={returnTo} activeTimerSessionId={activeTimerSessionId} />
          </div>
        </div>
        <div className="today-work-grid">
          <div className="today-lane-stack">
            {allTodayCount === 0 ? (
              <Card className="border-[var(--border)] bg-white">
                <CardContent className="space-y-3 px-5 pb-5 pt-5 text-center">
                  <EmptyState icon={CalendarCheck2} title="Nothing planned yet for today" description="Add tasks from pinned or in-progress suggestions to create a focused execution lane." action={<div className="flex flex-wrap items-center justify-center gap-2"><a href="#pinned-suggestions" className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-xs">Add from pinned</a><Link href="/tasks" className="btn-instrument flex h-8 items-center px-3 text-xs">Open all tasks</Link></div>} />
                </CardContent>
              </Card>
            ) : null}
            {allTodayCount > 0 ? (
              <>
                <TodaySection title="Today Timeline" count={todayData.scheduledBlocks.length} tone="muted" emptyState={<EmptyState icon={CircleDashed} title="No scheduled blocks for today" description="Scheduled tasks with time ranges will appear here." />}>
                  {todayData.scheduledBlocks.map((task) => (
                    <TodayTaskCard key={task.id} task={task} returnTo={returnTo} isCompleted={isTaskCompletedStatus(task.status)} activeTimerSessionId={activeTimerSessionId} startTimerLabel="Start Focus Session" startTimerReturnTo="/timer" />
                  ))}
                </TodaySection>
                <TodaySection title="Flexible Today backlog" count={flexibleTodayActionable.length} tone="muted" emptyState={<EmptyState icon={CircleDashed} title="No flexible tasks planned for today." description="Unscheduled tasks planned for today will appear here." />}>
                  {flexibleTodayActionable.map((task) => (
                    <TodayTaskCard key={task.id} task={task} returnTo={returnTo} activeTimerSessionId={activeTimerSessionId} />
                  ))}
                </TodaySection>
                <TodaySection title="Due today / active" count={todayData.planned.filter((t) => !t.isPlannedForToday).length + todayData.inProgress.filter((t) => !t.isPlannedForToday).length} tone="info" emptyState={<EmptyState icon={CirclePlay} title="No due-today carryover" description="Tasks due today but not manually planned will appear here." />}>
                  {[...todayData.inProgress.filter((t) => !t.isPlannedForToday), ...todayData.planned.filter((t) => !t.isPlannedForToday)].map((task) => (
                    <TodayTaskCard key={task.id} task={task} returnTo={returnTo} activeTimerSessionId={activeTimerSessionId} />
                  ))}
                </TodaySection>
                <TodaySection title="Blocked" count={todayData.blocked.length} tone="warn" emptyState={<EmptyState icon={CircleOff} title="No blocked tasks" description="Blocked work will surface here when status is set to blocked." />}>
                  {todayData.blocked.map((task) => (
                    <TodayTaskCard key={task.id} task={task} returnTo={returnTo} activeTimerSessionId={activeTimerSessionId} />
                  ))}
                </TodaySection>
                <TodaySection title="Completed" count={todayData.completed.length} tone="success" compactWhenEmpty headerActions={todayData.summary.clearableCompletedCount > 0 ? (<form action={clearCompletedFromTodayAction}><input type="hidden" name="returnTo" value={returnTo} /><PendingSubmitButton type="submit" variant="muted" size="sm" className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-xs" pendingLabel="Clearing...">Clear completed from Today</PendingSubmitButton></form>) : null} emptyState={<EmptyState icon={CircleCheck} title="No completed items yet" description="Completed Today tasks will appear here for quick cleanup." />}>
                  {todayData.completed.map((task) => (
                    <TodayTaskCard key={task.id} task={task} returnTo={returnTo} isCompleted activeTimerSessionId={activeTimerSessionId} />
                  ))}
                </TodaySection>
              </>
            ) : null}
          </div>
          <div className="today-assist-stack">
            <TodaySuggestionsPanel returnTo={returnTo} activeTimerSessionId={activeTimerSessionId} groups={[{ key: "pinned", title: "Pinned / focus", emptyText: "No pinned tasks right now.", items: todayData.suggestions.pinned }, { key: "in-progress", title: "Recently active", emptyText: "No in-progress suggestions right now.", items: todayData.suggestions.inProgress }]} />
            <Card className="border-[var(--border)] bg-white">
              <CardContent className="space-y-3 px-5 pb-5 pt-5">
                <p className="glass-label text-etch">Today status</p>
                <div className="flex flex-wrap gap-2"><Badge tone="muted">{allTodayCount} in Today</Badge><Badge tone="info">{todayData.summary.trackedTodayLabel} tracked</Badge></div>
                <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">Move from planning to execution quickly by starting a timer directly from any Today item.</p>
                <Link href="/timer" className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs">Open timer workspace</Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

export function TodayErrorView({ actionError }: { actionError: string | null }) {
  return (
    <div className="space-y-4">
      {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}
      <Card className="border-[var(--border)] bg-white"><CardContent className="px-6 pb-6 pt-6"><p className="text-sm text-[color:var(--muted-foreground)]">Could not load Today planner right now. Try again shortly.</p></CardContent></Card>
    </div>
  );
}
