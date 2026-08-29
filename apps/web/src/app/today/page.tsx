import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { getTodayPageModel } from "./_lib/today-page-model";
import { TodayPageView, TodayErrorView } from "./_components/TodayPageView";

export const metadata: Metadata = {
  title: "Today",
  description: "Plan intentional work for today with direct execution controls.",
};

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ actionError?: string; actionSuccess?: string; stoppedTaskId?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const model = await getTodayPageModel(resolvedSearchParams);
  if (model.error || !model.todayData) {
    return (
      <AppShell eyebrow="Execution" title="Today" description="What to do now and what comes next — clear queue, start focus.">
        <TodayErrorView actionError={model.actionError} />
      </AppShell>
    );
  }
  return (
    <AppShell
      eyebrow="Execution"
      title="Today"
      description={`${formatTaskDueDate(model.todayData.date)} · Choose the work that matters, then execute it.`}
      contentClassName="today-page-content"
      actions={<div className="flex items-center gap-2"><Link href="/tasks" className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center px-4">Open tasks</Link><Link href="/timer" className="btn-instrument glass-label flex h-8 items-center px-4">Open timer</Link></div>}
    >
      <TodayPageView model={model} />
    </AppShell>
  );
}
