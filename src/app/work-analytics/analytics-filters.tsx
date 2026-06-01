"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { FilterPill } from "@/components/ui/filter-pill";
import {
  buildFilterHref,
  RANGE_LABELS,
  GROUP_BY_LABELS,
  BREAKDOWN_BY_LABELS,
} from "@/lib/services/work-analytics-filters";
import type {
  AnalyticsRange,
  AnalyticsGroupBy,
  AnalyticsBreakdownBy,
} from "@/lib/services/work-analytics-filters";

const AVAILABLE_RANGES: AnalyticsRange[] = [
  "today",
  "7d",
  "30d",
  "mtm",
  "prev-month",
  "qtd",
];

const AVAILABLE_GROUP_BYS: AnalyticsGroupBy[] = ["day", "week", "month"];

const AVAILABLE_BREAKDOWN_BYS: AnalyticsBreakdownBy[] = [
  "project",
  "goal",
  "task",
];

export function AnalyticsFilters() {
  const pathname = usePathname();
  const rawSearchParams = useSearchParams();
  const searchParams = new URLSearchParams(rawSearchParams.toString());

  const currentRange: AnalyticsRange =
    (searchParams.get("range") as AnalyticsRange) ?? "30d";
  const currentGroupBy: AnalyticsGroupBy =
    (searchParams.get("groupBy") as AnalyticsGroupBy) ?? "day";
  const currentBreakdownBy: AnalyticsBreakdownBy =
    (searchParams.get("breakdownBy") as AnalyticsBreakdownBy) ?? "project";
  const currentIncludeOpen = searchParams.get("includeOpen") === "true";

  const makeHref = useCallback(
    (key: string, value: string | null) => {
      const qs = buildFilterHref(searchParams, key, value);
      return `${pathname}${qs}`;
    },
    [pathname, searchParams],
  );

  return (
    <div className="flex flex-wrap items-start gap-4">
      {/* Range selector */}
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-[color:var(--muted-foreground)]">
          Range
        </legend>
        <div className="flex flex-wrap gap-1">
          {AVAILABLE_RANGES.map((r) => (
            <FilterPill
              key={r}
              href={makeHref("range", r === "30d" ? null : r)}
              label={RANGE_LABELS[r]}
              active={currentRange === r}
              ariaCurrent={currentRange === r ? "page" : undefined}
            />
          ))}
        </div>
      </fieldset>

      {/* Group by selector */}
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-[color:var(--muted-foreground)]">
          Group by
        </legend>
        <div className="flex flex-wrap gap-1">
          {AVAILABLE_GROUP_BYS.map((g) => (
            <FilterPill
              key={g}
              href={makeHref("groupBy", g === "day" ? null : g)}
              label={GROUP_BY_LABELS[g]}
              active={currentGroupBy === g}
              ariaCurrent={currentGroupBy === g ? "page" : undefined}
            />
          ))}
        </div>
      </fieldset>

      {/* Breakdown by selector */}
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-[color:var(--muted-foreground)]">
          Breakdown
        </legend>
        <div className="flex flex-wrap gap-1">
          {AVAILABLE_BREAKDOWN_BYS.map((b) => (
            <FilterPill
              key={b}
              href={makeHref("breakdownBy", b === "project" ? null : b)}
              label={BREAKDOWN_BY_LABELS[b]}
              active={currentBreakdownBy === b}
              ariaCurrent={currentBreakdownBy === b ? "page" : undefined}
            />
          ))}
        </div>
      </fieldset>

      {/* Include open sessions toggle */}
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-[color:var(--muted-foreground)]">
          Include open sessions
        </legend>
        <div className="flex flex-wrap gap-1">
          <FilterPill
            href={makeHref("includeOpen", null)}
            label="Off"
            active={!currentIncludeOpen}
            ariaCurrent={!currentIncludeOpen ? "page" : undefined}
          />
          <FilterPill
            href={makeHref("includeOpen", "true")}
            label="On"
            active={currentIncludeOpen}
            ariaCurrent={currentIncludeOpen ? "page" : undefined}
          />
        </div>
      </fieldset>
    </div>
  );
}
