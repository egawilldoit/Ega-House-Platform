import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";
import { getFrictionRadar } from "@/lib/services/friction-service";
import { getHealthSnapshotData } from "@/lib/services/health-snapshot-service";
import { getReviewPageModel } from "./_lib/review-page-model";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { ReviewPageView } from "./_components/ReviewPageView";

export const metadata: Metadata = {
  title: "Review",
  description: "Weekly review reflection workflow.",
};

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ draft?: string; weekOf?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const [model, health, friction] = await Promise.all([
    getReviewPageModel(resolvedSearchParams),
    getHealthSnapshotData().catch(() => ({ errorMessage: "Health evidence is unavailable.", data: null, recommendations: [] })),
    getFrictionRadar().catch(() => ({ errorMessage: "Friction evidence is unavailable.", data: null })),
  ]);
  return (
    <>
Export CSV
        </ExportCsvButton>
      }
    >
      <ReviewPageView model={model} health={health} friction={friction} />
</>
  );
}
