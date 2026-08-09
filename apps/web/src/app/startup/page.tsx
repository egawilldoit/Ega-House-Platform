import type { Metadata } from "next";
import Link from "next/link";

import { StartupPlanner } from "@/components/startup/startup-planner";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { formatIsoDate } from "@/lib/review-week";
import { getStartupPlannerData } from "@/lib/services/startup-planner-service";

export const metadata: Metadata = {
  title: "Startup",
  description: "Weekly startup planning flow tied directly to review, goals, tasks, and Today.",
};

function StartupErrorState({ actionError }: { actionError: string | null }) {
  return (
    <div className="space-y-4">
      {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}
      <Card className="border-[var(--border)] bg-white">
        <CardContent className="p-6">
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Could not load weekly startup planning right now. Try again shortly.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function StartupPage({
  searchParams,
}: {
  searchParams: Promise<{ actionError?: string; actionSuccess?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const actionError = resolvedSearchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = resolvedSearchParams.actionSuccess?.slice(0, 180) ?? null;

  const startupResult = await getStartupPlannerData();

  if (startupResult.errorMessage || !startupResult.data) {
    return (
      <AppShell
        eyebrow="Weekly Planning"
        title="Startup"
        description="Build your weekly plan, then flow directly into Today."
      >
        <StartupErrorState actionError={actionError} />
      </AppShell>
    );
  }

  const startupData = startupResult.data;

  return (
    <AppShell
      eyebrow="Weekly Planning"
      title="Startup"
      description={`${formatIsoDate(startupData.week.weekStart)} · Set priorities for the week, then move to execution.`}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/today" className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center px-4">
            Open Today
          </Link>
          <Link href="/review" className="btn-instrument glass-label flex h-8 items-center px-4">
            Open Review
          </Link>
        </div>
      }
    >
      <div className="space-y-4">
        {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}
        {actionSuccess ? <p className="feedback-block feedback-block-success">{actionSuccess}</p> : null}
        <StartupPlanner data={startupData} returnTo="/startup" />
      </div>
    </AppShell>
  );
}
