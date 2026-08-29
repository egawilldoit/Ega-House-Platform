import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { getShutdownPageModel } from "./_lib/shutdown-page-model";
import { ShutdownPageView, ShutdownErrorView } from "./_components/ShutdownPageView";

export const metadata: Metadata = {
  title: "Shutdown",
  description: "Close your day, carry work forward safely, and prepare tomorrow.",
};

export default async function ShutdownPage({ searchParams }: { searchParams: Promise<{ actionError?: string; actionSuccess?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const model = await getShutdownPageModel(resolvedSearchParams);
  if (model.shutdownResult.errorMessage || !model.shutdownResult.data) {
    return (
      <AppShell eyebrow="Ritual" title="Shutdown" description="Close the day — completion, carry-over, reflection.">
        <ShutdownErrorView />
      </AppShell>
    );
  }
  const data = model.shutdownResult.data;
  return (
    <AppShell eyebrow="Ritual" title="Shutdown" description={`${formatTaskDueDate(data.date)} · Close the loop on today and set up tomorrow.`} actions={<div className="flex items-center gap-2"><Link href="/today" className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center px-4">Open today</Link><Link href="/review" className="btn-instrument flex h-8 items-center px-4">Review</Link></div>}>
      <ShutdownPageView model={model} />
    </AppShell>
  );
}
