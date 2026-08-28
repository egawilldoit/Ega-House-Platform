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
    <AppShell eyebrow="Focus" title="Timer" description="Active session is primary — elapsed, target, pause, stop." actions={<div className="flex gap-3"><Link href="/today" className="btn-instrument btn-instrument-muted flex h-8 items-center px-4">Today</Link><a href="/timer/export" className="btn-instrument btn-instrument-muted flex h-8 items-center px-4">Export CSV</a></div>}>
      <TimerActionFeedback actionError={model.actionError} actionSuccess={model.actionSuccess} />
      <TimerPageView model={model} />
    </AppShell>
  );
}
