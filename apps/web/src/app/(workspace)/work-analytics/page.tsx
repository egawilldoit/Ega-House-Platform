import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";
import { getWorkAnalyticsPageModel } from "./_lib/work-analytics-page-model";
import { InteractiveAnalytics } from "./interactive-analytics";

export const metadata: Metadata = {
  title: "Analytics",
  description: "Operational evidence and trends.",
};

export default async function WorkAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const normalized = Object.fromEntries(
    Object.entries(resolvedSearchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as Record<string, string | undefined>;
  const model = await getWorkAnalyticsPageModel(normalized);
  return (
    <>
      <WorkspacePageHeader title="Analytics" description="Operational evidence and trends." />
      <InteractiveAnalytics model={model} />
    </>
  );
}
