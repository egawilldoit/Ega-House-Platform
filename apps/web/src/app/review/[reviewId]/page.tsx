import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
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
    <article className="rounded-[var(--radius-lg)] border border-ega-border bg-ega-surface-subtle px-4 py-3">
      <p className="glass-label">{label}</p>
      <p className="mt-1.5 whitespace-pre-wrap text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text">
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
      title="Past review detail"
      description={`${formatIsoDate(review.week_start)} — ${formatIsoDate(review.week_end)} · saved reflection fields.`}
      actions={
        <Link
          href="/review"
          className="btn-instrument btn-instrument-muted inline-flex h-8 items-center px-3 text-[length:var(--text-meta-lg)]"
        >
          Back to review workspace
        </Link>
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
          <CardContent className="flex flex-col gap-3">
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
          <CardContent className="flex flex-col gap-2 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
            <p>
              <span className="text-ega-text">Created:</span> {formatDateTime(review.created_at)}
            </p>
            <p>
              <span className="text-ega-text">Updated:</span> {formatDateTime(review.updated_at)}
            </p>
            <p className="break-all">
              <span className="text-ega-text">Review ID:</span> {review.id}
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
