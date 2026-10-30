import type { Metadata } from "next";
import Link from "next/link";
import { TimerActionFeedback } from "@/components/timer/timer-action-feedback";
import { getTimerPageModel } from "./_lib/timer-page-model";
import { TimerPageView } from "./_components/TimerPageView";
import { ExportCsvButton } from "@/components/ui/export-csv-button";

export const metadata: Metadata = {
  title: "Timer",
  description: "Start and stop focused task sessions.",
};

export default async function TimerPage({ searchParams }: { searchParams: Promise<{ actionError?: string; actionSuccess?: string; stoppedTaskId?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const model = await getTimerPageModel(resolvedSearchParams);
  return (
    <AppShell
      title="Timer"
      description="Track focused work and review your recent sessions."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/today"
            className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
          >
            Open Today
          </Link>
          <ExportCsvButton
            href="/timer/export"
            defaultFilename="timer-sessions.csv"
            className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
          >
            Export CSV
          </ExportCsvButton>
        </div>
      }
    >
      <TimerActionFeedback actionError={model.actionError} actionSuccess={model.actionSuccess} />
      <TimerPageView model={model} />
    </AppShell>
  );
}
