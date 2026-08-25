import Link from "next/link";
import { ShutdownReflectionForm } from "@/components/shutdown/shutdown-reflection-form";
import { ShutdownTaskList } from "@/components/shutdown/shutdown-task-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatTaskDueDate } from "@/lib/task-due-date";
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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="muted">{formatTaskDueDate(data.date)}</Badge>
        <span className="text-sm text-[color:var(--muted-foreground)]">Close the loop on today and set up tomorrow.</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <div className="space-y-6">
          <ShutdownTaskList tasks={data.todayTasks} date={data.date} action={carryForwardTaskToTomorrowAction} />
          <Card className="border-[var(--border)] bg-white"><CardContent className="p-6"><h3 className="text-sm font-semibold text-[color:var(--foreground)]">Tomorrow&apos;s carry-over</h3><p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">{data.tomorrowTasks.length} tasks already scheduled for tomorrow.</p></CardContent></Card>
        </div>
        <div className="space-y-6">
          <ShutdownReflectionForm action={saveShutdownReflectionNoteAction} defaultNote={data.reflectionNote ?? ""} />
          <Card className="border-[var(--border)] bg-white"><CardContent className="p-6"><h3 className="text-sm font-semibold text-[color:var(--foreground)]">Reflection</h3><p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">Capture what happened and what changes next.</p><Link href="/review" className="btn-instrument btn-instrument-muted mt-4 inline-flex h-8 items-center px-3 text-xs">Open Review</Link></CardContent></Card>
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
