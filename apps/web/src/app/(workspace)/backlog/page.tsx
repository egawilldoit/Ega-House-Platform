import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";
import { getBacklogPageModel } from "./_lib/backlog-page-model";
import { BacklogPageView } from "./_components/BacklogPageView";

export const metadata: Metadata = {
  title: "Backlog",
  description: "Capture, triage and promote future work.",
};

export default async function BacklogPage({ searchParams }: { searchParams: Promise<{ actionError?: string; actionSuccess?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const model = await getBacklogPageModel(resolvedSearchParams);
  return (
    <>
      <WorkspacePageHeader title="Backlog" description="Capture, triage and promote future work." />
      <BacklogPageView model={model} actionError={resolvedSearchParams.actionError} actionSuccess={resolvedSearchParams.actionSuccess} />
    </>
  );
}
