import { AppShell } from "@/components/layout/app-shell";
import { getWorkAnalyticsPageModel } from "./_lib/work-analytics-page-model";
import { WorkAnalyticsPageView } from "./_components/WorkAnalyticsPageView";

export const dynamic = "force-dynamic";

export default async function WorkAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; groupBy?: string; breakdownBy?: string; includeOpen?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const model = await getWorkAnalyticsPageModel(resolvedSearchParams as unknown as Record<string, string | undefined>);
  if (!model.user) return <div className="p-6">Please log in to view work analytics.</div>;
  if (model.error) return <div className="p-6">{model.error}</div>;
  return (
    <AppShell eyebrow="Evidence" title="Analytics" description="Focused time answers — explicit, not decorative.">
      <WorkAnalyticsPageView model={model} />
    </AppShell>
  );
}
