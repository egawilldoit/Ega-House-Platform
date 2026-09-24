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
    <AppShell
      title="Review"
      description="What happened this week, and what to change next."
      actions={
        <a
          href={`/review/export?weekOf=${model.weekOf}`}
          className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-[length:var(--text-meta-lg)]"
        >
          Export CSV
        </a>
      }
    >
      <ReviewPageView model={model} health={health} friction={friction} />
    </AppShell>
  );
}
