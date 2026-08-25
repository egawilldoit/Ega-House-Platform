import Link from "next/link";
import { StartupPlanner } from "@/components/startup/startup-planner";
import { Card, CardContent } from "@/components/ui/card";
import { formatIsoDate } from "@/lib/review-week";
import type { StartupPageModel } from "../_lib/startup-page-model";

export function StartupErrorView({ actionError }: { actionError: string | null }) {
  return (
    <div className="space-y-4">
      {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}
      <Card className="border-[var(--border)] bg-white"><CardContent className="p-6"><p className="text-sm text-[color:var(--muted-foreground)]">Could not load weekly startup planning right now. Try again shortly.</p></CardContent></Card>
    </div>
  );
}

export function StartupPageView({ model }: { model: StartupPageModel }) {
  const { actionError, actionSuccess, startupResult } = model;
  if (startupResult.errorMessage || !startupResult.data) return <StartupErrorView actionError={actionError} />;
  const startupData = startupResult.data;
  return (
    <>
      {actionSuccess ? <p className="feedback-block feedback-block-success mb-4">{actionSuccess}</p> : null}
      {actionError ? <p className="feedback-block feedback-block-error mb-4">{actionError}</p> : null}
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-[color:var(--muted-foreground)]">{formatIsoDate(startupData.week.weekStart)} · Set priorities for the week, then move to execution.</p>
        <Link href="/today" className="btn-instrument btn-instrument-muted flex h-8 items-center px-4">Open Today</Link>
      </div>
      <StartupPlanner data={startupData} />
    </>
  );
}
