import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { AnalyticsFilters } from "./analytics-filters";
import { getWorkAnalyticsPageModel } from "./_lib/work-analytics-page-model";
import { WorkAnalyticsPageView } from "./_components/WorkAnalyticsPageView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Analytics",
  description: "See where your focused time goes.",
};

export default async function WorkAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; groupBy?: string; breakdownBy?: string; includeOpen?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const model = await getWorkAnalyticsPageModel(resolvedSearchParams as unknown as Record<string, string | undefined>);
  return (
    <AppShell
      title="Analytics"
      description="See where your focused time goes."
      actions={<AnalyticsFilters />}
    >
      <WorkAnalyticsPageView model={model} />
    </AppShell>
  );
}
