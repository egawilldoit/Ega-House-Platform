import type { Metadata } from "next";
import { CanonicalLink } from "@/components/layout/canonical-link";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
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
    <>
      <WorkspacePageHeader
        title="Goals"
        description="Objectives with health, progress, next step, and linked tasks."
        actions={
          <CanonicalLink
            href="/tasks/projects"
            className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
          >
            Projects
          </CanonicalLink>
        }
      />
      <GoalsPageView model={model} />
    </>
  );
}
