import type { Metadata } from "next";
import Link from "next/link";

import {
  carryForwardTaskToTomorrowAction,
  saveShutdownReflectionNoteAction,
} from "@/app/shutdown/actions";
import { AppShell } from "@/components/layout/app-shell";
import { ShutdownReflectionForm } from "@/components/shutdown/shutdown-reflection-form";
import { ShutdownTaskList } from "@/components/shutdown/shutdown-task-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatIsoDate } from "@/lib/review-week";
import { getShutdownData } from "@/lib/services/shutdown-service";
import { formatTaskDueDate } from "@/lib/task-due-date";

export const metadata: Metadata = {
  title: "Shutdown",
  description: "Close your day, carry work forward safely, and prepare tomorrow.",
};

export default async function ShutdownPage({
  searchParams,
}: {
  searchParams: Promise<{ actionError?: string; actionSuccess?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const actionError = resolvedSearchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = resolvedSearchParams.actionSuccess?.slice(0, 180) ?? null;
  const shutdownResult = await getShutdownData();

  if (shutdownResult.errorMessage || !shutdownResult.data) {
    return (
      <AppShell
        eyebrow="Execution Workspace"
        title="Shutdown"
        description="Close out work, capture blockers, and prep the next day."
      >
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="p-6">
            <p className="text-sm text-[color:var(--muted-foreground)]">
              Could not load shutdown workflow right now. Try again shortly.
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const data = shutdownResult.data;

  return (
    <AppShell
      eyebrow="Execution Workspace"
      title="Shutdown"
      description={`${formatTaskDueDate(data.date)} · Close the loop on today and set up tomorrow.`}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/today" className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center px-4">
            Open today
          </Link>
          <Link href="/timer" className="btn-instrument glass-label flex h-8 items-center px-4">
            Open timer
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}
        {actionSuccess ? <p className="feedback-block feedback-block-success">{actionSuccess}</p> : null}

        <Card className="border-[var(--border)] bg-white">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="glass-label text-etch">End-of-day summary</p>
                <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  {formatTaskDueDate(data.date)} closeout with a direct handoff into{" "}
                  {formatTaskDueDate(data.tomorrowDate)} planning.
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

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(21rem,0.85fr)]">
          <div className="space-y-4">
            <ShutdownTaskList
              title="Completed work"
              description="What was closed out today."
              emptyMessage="No completed work logged in Today yet."
              tasks={data.completedWork}
            />

            <ShutdownTaskList
              title="Unfinished carry-forward"
              description="Queue unfinished work into tomorrow without changing status."
              emptyMessage="No unfinished Today items need carry-forward."
              tasks={data.unfinishedCarryForward}
              action={carryForwardTaskToTomorrowAction}
              actionLabel="Carry to tomorrow"
              returnTo="/shutdown"
            />

            <ShutdownTaskList
              title="Blockers noted today"
              description="Open blockers that need a next action tomorrow."
              emptyMessage="No blockers logged in Today."
              tasks={data.blockers}
            />
          </div>

          <div className="space-y-4">
            <ShutdownTaskList
              title="Prepare tomorrow shortlist"
              description="Pin tomorrow's first moves from due-soon and focus candidates."
              emptyMessage="No shortlist suggestions yet. Open /today or /tasks to select tomorrow work."
              tasks={data.tomorrowShortlist}
              action={carryForwardTaskToTomorrowAction}
              actionLabel="Add to tomorrow"
              returnTo="/shutdown"
            />

            <Card className="border-[var(--border)] bg-white">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-[color:var(--foreground)]">Reflection note</h2>
                  <Badge tone="muted">Optional</Badge>
                </div>
                <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                  Save a short shutdown note into this week&apos;s review `next steps`.
                </p>
                <ShutdownReflectionForm
                  action={saveShutdownReflectionNoteAction}
                  returnTo="/shutdown"
                />

                {data.currentWeekReview ? (
                  <div className="surface-subtle space-y-1 p-3 text-xs text-[color:var(--muted-foreground)]">
                    <p className="font-medium text-[color:var(--foreground)]">
                      Week review updated {new Date(data.currentWeekReview.updatedAt).toLocaleDateString("en-US")}
                    </p>
                    <p className="line-clamp-3">
                      {(data.currentWeekReview.nextSteps || data.currentWeekReview.summary || "No weekly notes yet.").trim()}
                    </p>
                  </div>
                ) : null}

                <Link
                  href={`/review?weekOf=${data.date}`}
                  className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs"
                >
                  Open weekly review
                </Link>
              </CardContent>
            </Card>

            <Card className="border-[var(--border)] bg-white">
              <CardContent className="space-y-2 p-5">
                <p className="glass-label text-etch">Tomorrow setup</p>
                <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                  Tomorrow is set to {formatIsoDate(data.tomorrowDate)}. Queue critical items now, then start in{" "}
                  <Link href="/today" className="font-medium text-signal-live hover:underline">
                    Today
                  </Link>{" "}
                  for a clean handoff.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
