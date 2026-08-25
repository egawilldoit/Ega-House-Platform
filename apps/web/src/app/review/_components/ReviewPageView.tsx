import Link from "next/link";
import { SessionHeatmap } from "@/components/review/session-heatmap";
import { WeekBarChart } from "@/components/review/week-bar-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime, formatIsoDate, shiftIsoDateByDays } from "@/lib/review-week";
import { ReviewForm } from "../review-form";
import { WeekSelector } from "../week-selector";
import type { ReviewPageModel } from "../_lib/review-page-model";

function toSummaryPreview(summary: string | null, maxLength = 200) {
  const normalized = summary?.trim() ?? "";
  if (!normalized) return "No summary text.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

export function ReviewPageView({ model }: { model: ReviewPageModel }) {
  const { data } = model;
  const { bounds, selectedWeekOf, selectedReview, pastReviews, weekBarData, sessionHeatmap, sparseHeatmap, reviewFormDefaults, generatedDraftHref, shouldUseGeneratedDraft } = data as unknown as {
    bounds: { weekStart: string; weekEnd: string };
    selectedWeekOf: string;
    selectedReview: { id: string; summary: string | null; updated_at: string | null; created_at: string } | null;
    pastReviews: Array<{ id: string; summary: string | null; updated_at: string | null; created_at: string }>;
    weekBarData: unknown;
    sessionHeatmap: unknown;
    sparseHeatmap: boolean;
    reviewFormDefaults: unknown;
    generatedDraftHref: string;
    shouldUseGeneratedDraft: boolean;
  };
  const previousWeekOf = shiftIsoDateByDays(selectedWeekOf, -7);
  const nextWeekOf = shiftIsoDateByDays(selectedWeekOf, 7);
  return (
    <div className="space-y-6">
      <WeekSelector
        selectedWeekOf={selectedWeekOf}
        weekStart={bounds.weekStart}
        weekEnd={bounds.weekEnd}
        previousWeekOf={previousWeekOf}
        nextWeekOf={nextWeekOf}
        existingReviewCount={selectedReview ? 1 : 0}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.9fr)]">
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="px-6 pb-6 pt-6">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[color:var(--foreground)]">Weekly Review</h2>
                <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">{selectedReview && !shouldUseGeneratedDraft ? "Saved content is loaded for editing." : "Activity-derived draft is editable before save."}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <Badge tone="muted">{formatIsoDate(bounds.weekStart)}</Badge>
                {selectedReview ? <Link href={generatedDraftHref} className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center px-3">Regenerate</Link> : null}
              </div>
            </div>
            <ReviewForm key={`${selectedWeekOf}:${selectedReview?.id ?? "new"}:${shouldUseGeneratedDraft ? "generated" : "saved"}`} defaultValues={reviewFormDefaults} />
          </CardContent>
        </Card>
        <Card className="border-[var(--border)] bg-white">
          <CardContent className="px-6 pb-6 pt-6">
            <div className="mb-5"><h2 className="text-lg font-semibold text-[color:var(--foreground)]">Activity</h2>{sparseHeatmap ? <WeekBarChart data={weekBarData} /> : <SessionHeatmap data={sessionHeatmap} />}</div>
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3"><h2 className="text-lg font-semibold text-[color:var(--foreground)]">Activity Stream</h2><Link href="/review" className="glass-label text-signal-live">View All</Link></div>
            <Card className="border-[var(--border)] bg-white"><CardContent className="px-6 pb-6 pt-6">{pastReviews.length > 0 ? <div className="relative space-y-6 before:absolute before:bottom-2 before:left-4 before:top-2 before:w-px before:bg-[var(--border)]">{pastReviews.slice(0, 4).map((review, index) => (<div key={review.id} className="relative z-10 flex gap-4"><div className={`flex h-8 w-8 items-center justify-center rounded-full border ${index === 0 ? "border-[var(--signal-live)] bg-[rgba(34,197,94,0.12)]" : "border-[var(--border)] bg-[color:var(--instrument-raised)]"}`}><span className={`h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-[var(--signal-live)]" : "bg-[color:var(--muted-foreground)]"}`} /></div><div className="flex-1"><div className="flex items-baseline justify-between gap-3"><div className="text-sm font-semibold text-[color:var(--foreground)]">Review updated</div><div className="text-xs text-[color:var(--muted-foreground)]">{formatDateTime(review.updated_at ?? review.created_at)}</div></div><div className="surface-subtle mt-2 p-3 text-xs leading-6 text-[color:var(--muted-foreground)]">{toSummaryPreview(review.summary, 140)}</div></div></div>))}</div> : <div className="surface-empty px-4 py-5 text-sm leading-7 text-[color:var(--muted-foreground)]">No saved reviews yet.</div>}</CardContent></Card>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
