import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";
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
      <>
<StartupErrorView actionError={model.actionError} />
</>
    );
  }
  return (
    <>
<StartupPageView model={model} />
</>
  );
}
