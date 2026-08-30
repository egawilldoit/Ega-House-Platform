import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { getFrictionRadar } from "@/lib/services/friction-service";
import { getHealthSnapshotData } from "@/lib/services/health-snapshot-service";
import { getReviewPageModel } from "./_lib/review-page-model";
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
    <AppShell eyebrow="Reflection" title="Review" description="What happened and what changes next — evidence, trends, feedback.">
      <ReviewPageView model={model} health={health} friction={friction} />
    </AppShell>
  );
}
