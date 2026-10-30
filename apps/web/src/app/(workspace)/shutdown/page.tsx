import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { getShutdownPageModel } from "./_lib/shutdown-page-model";
import { ShutdownPageView, ShutdownErrorView } from "./_components/ShutdownPageView";

export const metadata: Metadata = {
  title: "Shutdown",
  description: "Close the day — completion, carry-over, reflection.",
};

export default async function ShutdownPage({
  searchParams,
}: {
  searchParams: Promise<{ actionError?: string; actionSuccess?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const model = await getShutdownPageModel(resolvedSearchParams);
  if (model.shutdownResult.errorMessage || !model.shutdownResult.data) {
    return (
      <>
        <WorkspacePageHeader title="Shutdown" description="Close the day — completion, carry-over, reflection." />
        <ShutdownErrorView />
      </>
    );
  }
  const data = model.shutdownResult.data;
  return (
    <>
      <WorkspacePageHeader
        title="Shutdown"
        description="Close the day — completion, carry-over, reflection."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/today" className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-xs">
              Open today
            </Link>
            <Link href="/review" className="btn-instrument inline-flex h-8 items-center px-3 text-xs">
              Review
            </Link>
          </div>
        }
      />
      <ShutdownPageView model={model} />
    </>
  );
}
