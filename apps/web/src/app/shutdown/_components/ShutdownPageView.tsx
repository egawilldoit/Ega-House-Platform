import Link from "next/link";
import { ShutdownReflectionForm } from "@/components/shutdown/shutdown-reflection-form";
import { ShutdownTaskList } from "@/components/shutdown/shutdown-task-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { formatIsoDate } from "@/lib/review-week";
import { carryForwardTaskToTomorrowAction, saveShutdownReflectionNoteAction } from "../actions";
import type { ShutdownPageModel } from "../_lib/shutdown-page-model";

export function ShutdownPageView({ model }: { model: ShutdownPageModel }) {
  const { actionError, actionSuccess, shutdownResult } = model;
  if (shutdownResult.errorMessage || !shutdownResult.data) return null;
  const data = shutdownResult.data;
  return (
    <>
      {actionSuccess ? <p className="feedback-block feedback-block-success mb-4">{actionSuccess}</p> : null}
      {actionError ? <p className="feedback-block feedback-block-error mb-4">{actionError}</p> : null}
      <Card className="border-[var(--border)] bg-white">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="glass-label text-etch">End-of-day summary</p>
              <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                {formatTaskDueDate(data.date)} closeout with a direct handoff into {formatTaskDueDate(data.tomorrowDate)} planning.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{data.summary.completedCount} completed</Badge>
              <Badge tone="warn">{data.summary.blockerCount} blockers</Badge>
              <Badge tone="info">{data.summary.unfinishedCount} to carry</Badge>
              <Badge tone="muted">{data.summary.trackedTodayLabel} tracked</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="workspace-main-rail-grid">
        <div className="space-y-4">
          <ShutdownTaskList title="Completed work" description="What was closed out today." emptyMessage="No completed work logged in Today yet." tasks={data.completedWork} />
          <ShutdownTaskList title="Unfinished carry-forward" description="Queue unfinished work into tomorrow without changing status." emptyMessage="No unfinished Today items need carry-forward." tasks={data.unfinishedCarryForward} action={carryForwardTaskToTomorrowAction} actionLabel="Carry to tomorrow" returnTo="/shutdown" />
          <ShutdownTaskList title="Blockers noted today" description="Open blockers that need a next action tomorrow." emptyMessage="No blockers logged in Today." tasks={data.blockers} />
        </div>
        <div className="space-y-4">
          <ShutdownTaskList title="Prepare tomorrow shortlist" description="Pin tomorrow's first moves from due-soon and focus candidates." emptyMessage="No shortlist suggestions yet. Open /today or /tasks to select tomorrow work." tasks={data.tomorrowShortlist} action={carryForwardTaskToTomorrowAction} actionLabel="Add to tomorrow" returnTo="/shutdown" />
          <Card className="border-[var(--border)] bg-white">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-[color:var(--foreground)]">Reflection note</h2>
                <Badge tone="muted">Optional</Badge>
              </div>
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">Save a short shutdown note into this week&apos;s review `next steps`.</p>
              <ShutdownReflectionForm action={saveShutdownReflectionNoteAction} returnTo="/shutdown" />
              {data.currentWeekReview ? (
                <div className="surface-subtle space-y-1 p-3 text-xs text-[color:var(--muted-foreground)]">
                  <p className="font-medium text-[color:var(--foreground)]">Week review updated {new Date(data.currentWeekReview.updatedAt).toLocaleDateString("en-US")}</p>
                  <p className="line-clamp-3">{(data.currentWeekReview.nextSteps || data.currentWeekReview.summary || "No weekly notes yet.").trim()}</p>
                </div>
              ) : null}
              <Link href={`/review?weekOf=${data.date}`} className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs">Open weekly review</Link>
            </CardContent>
          </Card>
          <Card className="border-[var(--border)] bg-white">
            <CardContent className="space-y-2 p-5">
              <p className="glass-label text-etch">Tomorrow setup</p>
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">Tomorrow is set to {formatIsoDate(data.tomorrowDate)}. Queue critical items now, then start in <Link href="/today" className="font-medium text-signal-live hover:underline">Today</Link> for a clean handoff.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export function ShutdownErrorView() {
  return (
    <Card className="border-[var(--border)] bg-white"><CardContent className="p-6"><p className="text-sm text-[color:var(--muted-foreground)]">Could not load shutdown workflow right now. Try again shortly.</p></CardContent></Card>
  );
}
