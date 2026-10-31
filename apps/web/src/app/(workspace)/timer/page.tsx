import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";
import { TimerPageView } from "./_components/TimerPageView";
import { getTimerPageModel } from "./_lib/timer-page-model";

export const metadata: Metadata = {
  title: "Timer",
  description: "Focus session timer with live tracking and history.",
};

export default async function TimerPage({ searchParams }: { searchParams: Promise<{ stoppedTaskId?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const model = await getTimerPageModel(resolvedSearchParams);
  return (
    <>
      <WorkspacePageHeader title="Timer" description="Focus session timer with live tracking and history." />
      <TimerPageView model={model} />
    </>
  );
}
