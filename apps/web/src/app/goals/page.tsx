import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { getGoalsPageModel } from "./_lib/goals-page-model";
import { GoalsPageView } from "./_components/GoalsPageView";

export const metadata: Metadata = {
  title: "Goals",
  description: "Goals list and creation flow.",
};

type GoalsPageProps = {
  searchParams: Promise<{
    goal?: string;
    view?: string;
    goalUpdateError?: string;
    goalUpdateGoalId?: string;
    goalUpdateField?: string;
  }>;
};

export default async function GoalsPage({ searchParams }: GoalsPageProps) {
  const resolvedSearchParams = await searchParams;
  const model = await getGoalsPageModel(resolvedSearchParams);

  return (
    <AppShell eyebrow="Direction" title={model.focusedGoal?.title ?? "Goals"} description="Objectives with health, progress, and next step.">
      <GoalsPageView model={model} />
    </AppShell>
  );
}
