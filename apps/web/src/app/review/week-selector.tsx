import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { formatIsoDate } from "@/lib/review-week";

type WeekSelectorProps = {
  selectedWeekOf: string;
  weekStart: string;
  weekEnd: string;
  previousWeekOf: string;
  nextWeekOf: string;
  existingReviewCount: number;
};

export function WeekSelector({
  selectedWeekOf,
  weekStart,
  weekEnd,
  previousWeekOf,
  nextWeekOf,
  existingReviewCount,
}: WeekSelectorProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <form action="/review" method="get" className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[180px] flex-1 flex-col gap-1">
            <label htmlFor="review-week-selector" className="glass-label">
              Selected week
            </label>
            <Input
              id="review-week-selector"
              name="weekOf"
              type="date"
              defaultValue={selectedWeekOf}
              required
              className="h-8 max-w-xs px-2 text-[length:var(--text-meta-lg)]"
            />
          </div>
          <PendingSubmitButton type="submit" variant="muted" size="md" pendingLabel="Viewing…">
            View week
          </PendingSubmitButton>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[length:var(--text-meta-lg)] font-medium tabular-nums text-ega-text">
              {formatIsoDate(weekStart)} — {formatIsoDate(weekEnd)}
            </p>
            <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
              {existingReviewCount > 0
                ? `${existingReviewCount} saved ${existingReviewCount === 1 ? "review" : "reviews"} this week`
                : "No saved review yet for this week"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/review?weekOf=${previousWeekOf}`}
              className="btn-instrument btn-instrument-muted flex h-8 items-center gap-1 px-3 text-[length:var(--text-meta-lg)]"
            >
              <span aria-hidden="true">←</span> Prev
            </Link>
            <Link
              href={`/review?weekOf=${nextWeekOf}`}
              className="btn-instrument btn-instrument-muted flex h-8 items-center gap-1 px-3 text-[length:var(--text-meta-lg)]"
            >
              Next <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
