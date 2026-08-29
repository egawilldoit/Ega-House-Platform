import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { getStartupPageModel } from "./_lib/startup-page-model";
import { StartupPageView, StartupErrorView } from "./_components/StartupPageView";

export const metadata: Metadata = {
  title: "Startup",
  description: "Weekly startup planning flow tied directly to review, goals, tasks, and Today.",
};

export default async function StartupPage({ searchParams }: { searchParams: Promise<{ actionError?: string; actionSuccess?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const model = await getStartupPageModel(resolvedSearchParams);
  if (model.startupResult.errorMessage || !model.startupResult.data) {
    return (
      <AppShell eyebrow="Ritual" title="Startup" description="Intentional daily start — priorities, attention, focus decision.">
        <StartupErrorView actionError={model.actionError} />
      </AppShell>
    );
  }
  return (
    <AppShell eyebrow="Ritual" title="Startup" description={`${model.startupResult.data.week.weekStart} · Set priorities for the week, then move to execution.`}>
      <StartupPageView model={model} />
    </AppShell>
  );
}
