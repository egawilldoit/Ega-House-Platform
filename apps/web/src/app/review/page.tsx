import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { getReviewPageModel } from "./_lib/review-page-model";
import { ReviewPageView } from "./_components/ReviewPageView";

export const metadata: Metadata = {
  title: "Review",
  description: "Weekly review reflection workflow.",
};

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ draft?: string; weekOf?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const model = await getReviewPageModel(resolvedSearchParams);
  return (
    <AppShell eyebrow="Reflection" title="Review" description="What happened and what changes next — evidence, trends, feedback.">
      <ReviewPageView model={model} searchParams={resolvedSearchParams} />
    </AppShell>
  );
}
