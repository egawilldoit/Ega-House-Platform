import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { TimerActionFeedback } from "@/components/timer/timer-action-feedback";
import { getTimerPageModel } from "./_lib/timer-page-model";
import { TimerPageView } from "./_components/TimerPageView";

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
      description="The active session is primary: elapsed time, stop, and the canonical session history."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/today"
            className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
          >
            Today
          </Link>
          <a
            href="/timer/export"
            className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
          >
            Export CSV
          </a>
        </div>
      }
    >
      <TimerActionFeedback actionError={model.actionError} actionSuccess={model.actionSuccess} />
      <TimerPageView model={model} />
    </AppShell>
  );
}
