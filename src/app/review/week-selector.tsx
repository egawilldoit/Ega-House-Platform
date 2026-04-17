import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="space-y-4 rounded-xl border border-[var(--border)] bg-white px-4 py-4 lg:max-w-4xl">
      <form action="/review" method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 flex-1 min-w-[160px]">
          <label htmlFor="review-week-selector" className="glass-label text-etch">
            Selected week
          </label>
          <Input
            id="review-week-selector"
            name="weekOf"
            type="date"
            defaultValue={selectedWeekOf}
            required
            className="max-w-xs"
          />
        </div>
        <Button type="submit" variant="muted" size="sm">
          View week
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="glass-label text-etch">
            {formatIsoDate(weekStart)} — {formatIsoDate(weekEnd)}
          </span>
          <p className="glass-label text-etch mt-1">
            {existingReviewCount > 0
              ? `${existingReviewCount} saved ${existingReviewCount === 1 ? "review" : "reviews"} this week`
              : "No saved review yet for this week"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/review?weekOf=${previousWeekOf}`}
            className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center px-3"
          >
            ← Prev
          </Link>
          <Link
            href={`/review?weekOf=${nextWeekOf}`}
            className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center px-3"
          >
            Next →
          </Link>
        </div>
      </div>
    </div>
  );
}
