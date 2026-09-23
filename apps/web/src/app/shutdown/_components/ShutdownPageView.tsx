import Link from "next/link";

import { formatDisplayDate } from "@/lib/presentation-format";
import { ShutdownReflectionForm } from "@/components/shutdown/shutdown-reflection-form";
import { ShutdownTaskList } from "@/components/shutdown/shutdown-task-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { CompactStat } from "@/components/ui/metric";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { formatIsoDate } from "@/lib/review-week";
import { carryForwardTaskToTomorrowAction, saveShutdownReflectionNoteAction } from "../actions";
import type { ShutdownPageModel } from "../_lib/shutdown-page-model";

export function ShutdownPageView({ model }: { model: ShutdownPageModel }) {
  const { actionError, actionSuccess, shutdownResult } = model;
  if (shutdownResult.errorMessage || !shutdownResult.data) return null;
  const data = shutdownResult.data;

  return (
    <div className="flex flex-col gap-8">
      {actionSuccess ? <p className="feedback-block">{actionSuccess}</p> : null}
      {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}

      <DashboardSection
        title="Results"
        description={`What closed out on ${formatTaskDueDate(data.date)}.`}
      >
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-10 gap-y-4">
              <CompactStat label="Completed" value={data.summary.completedCount} />
              <CompactStat label="Blockers" value={data.summary.blockerCount} />
              <CompactStat label="To carry" value={data.summary.unfinishedCount} />
              <CompactStat label="Tracked today" value={data.summary.trackedTodayLabel} />
            </CardContent>
          </Card>
          <ShutdownTaskList
            title="Completed work"
            description="What was closed out today."
            emptyMessage="No completed work logged in Today yet."
            tasks={data.completedWork}
          />
        </div>
      </DashboardSection>

      <DashboardSection
        title="Unfinished"
        description="Work left open today and blockers that need a next action tomorrow."
      >
        <div className="workspace-split-grid">
          <ShutdownTaskList
            title="Unfinished carry-forward"
            description="Queue unfinished work into tomorrow without changing status."
            emptyMessage="No unfinished Today items need carry-forward."
            tasks={data.unfinishedCarryForward}
            action={carryForwardTaskToTomorrowAction}
            actionLabel="Carry to tomorrow"
            actionPendingLabel="Carrying forward…"
            returnTo="/shutdown"
          />
          <ShutdownTaskList
            title="Blockers noted today"
            description="Open blockers that need a next action tomorrow."
            emptyMessage="No blockers logged in Today."
            tasks={data.blockers}
          />
        </div>
      </DashboardSection>

      <DashboardSection
        title="Carry forward"
        description="Pin tomorrow's first moves from due-soon and focus candidates."
      >
        <ShutdownTaskList
          title="Prepare tomorrow shortlist"
          description="Pin tomorrow's first moves from due-soon and focus candidates."
          emptyMessage="No shortlist suggestions yet. Open /today or /tasks to select tomorrow work."
          tasks={data.tomorrowShortlist}
          action={carryForwardTaskToTomorrowAction}
          actionLabel="Add to tomorrow"
          actionPendingLabel="Carrying forward…"
          returnTo="/shutdown"
        />
      </DashboardSection>

      <DashboardSection
        title="Reflection"
        description="Capture the win, the friction, and the first move for tomorrow."
      >
        <div className="workspace-main-rail-grid">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Reflection note</CardTitle>
                  <CardDescription>
                    Save a short shutdown note into this week&apos;s review next steps.
                  </CardDescription>
                </div>
                <Badge tone="muted">Optional</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ShutdownReflectionForm
                action={saveShutdownReflectionNoteAction}
                returnTo="/shutdown"
              />
            </CardContent>
          </Card>

          <div className="workspace-secondary-rail">
            <Card>
              <CardHeader>
                <CardTitle>This week&apos;s review</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {data.currentWeekReview ? (
                  <div className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface-subtle)] p-3">
                    <p className="text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text)]">
                      Updated {formatDisplayDate(data.currentWeekReview.updatedAt, "detail")}
                    </p>
                    <p className="mt-1 line-clamp-3 text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
                      {(data.currentWeekReview.nextSteps || data.currentWeekReview.summary || "No weekly notes yet.").trim()}
                    </p>
                  </div>
                ) : (
                  <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
                    No weekly notes yet.
                  </p>
                )}
                <Link
                  href={`/review?weekOf=${data.date}`}
                  className="btn-instrument btn-instrument-muted inline-flex h-8 w-fit items-center px-3 text-xs"
                >
                  Open weekly review
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </DashboardSection>

      <DashboardSection
        title="Finish day"
        description="Confirm the handoff into tomorrow."
      >
        <Card>
          <CardContent>
            <p className="max-w-[80ch] text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
              Tomorrow is set to {formatIsoDate(data.tomorrowDate)}. Queue critical items now,
              then start in{" "}
              <Link href="/today" className="font-medium text-[color:var(--ega-text)] underline">
                Today
              </Link>{" "}
              for a clean handoff.
            </p>
          </CardContent>
        </Card>
      </DashboardSection>
    </div>
  );
}

export function ShutdownErrorView() {
  return (
    <Card>
      <CardContent>
        <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
          Could not load shutdown workflow right now. Try again shortly.
        </p>
      </CardContent>
    </Card>
  );
}
