import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateTime, formatIsoDate } from "@/lib/review-week";
import { createClient } from "@/lib/supabase/server";

import { getReviewDetailFields, toFieldValue } from "../review-detail-state";

type ReviewDetailPageProps = {
  params: Promise<{
    reviewId: string;
  }>;
};

export const metadata = {
  title: "Past Review",
  description: "Inspect a saved weekly review entry.",
};

async function getReview(reviewId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("week_reviews")
    .select("id, week_start, week_end, summary, wins, blockers, next_steps, created_at, updated_at")
    .eq("id", reviewId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load review: ${error.message}`);
  }

  return data;
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <article className="rounded-[1.25rem] border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4">
      <p className="text-overline">{label}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[color:var(--foreground)]">
        {toFieldValue(value)}
      </p>
    </article>
  );
}

export default async function ReviewDetailPage({ params }: ReviewDetailPageProps) {
  const { reviewId } = await params;
  const review = await getReview(reviewId);

  if (!review) {
    notFound();
  }

  return (
    <AppShell
      eyebrow="Review Workspace"
      title="Past review detail"
      description="Inspect a full weekly review entry and its captured reflection fields."
      actions={
        <Link
          href="/review"
          className="btn-instrument btn-instrument-muted inline-flex min-h-12 items-center justify-center px-5 text-sm"
        >
          Back to review workspace
        </Link>
      }
      navigation={
        <>
          <Badge tone="accent">{formatIsoDate(review.week_start)}</Badge>
          <Badge>{formatIsoDate(review.week_end)}</Badge>
        </>
      }
    >
      <div className="workspace-main-rail-grid">
        <Card>
          <CardHeader>
            <CardTitle>Weekly review</CardTitle>
            <CardDescription>
              {formatIsoDate(review.week_start)} to {formatIsoDate(review.week_end)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-1">
            {getReviewDetailFields(review).map((field) => (
              <DetailField key={field.label} label={field.label} value={field.value} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Record metadata</CardTitle>
            <CardDescription>Lifecycle timestamps for this review record.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-1 text-sm leading-7 text-[color:var(--muted-foreground)]">
            <p>
              <span className="text-[color:var(--foreground)]">Created:</span> {formatDateTime(review.created_at)}
            </p>
            <p>
              <span className="text-[color:var(--foreground)]">Updated:</span> {formatDateTime(review.updated_at)}
            </p>
            <p>
              <span className="text-[color:var(--foreground)]">Review ID:</span> {review.id}
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
