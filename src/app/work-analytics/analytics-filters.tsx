"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
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
  const router = useRouter();
  const rawSearchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const searchParams = useMemo(
    () => new URLSearchParams(rawSearchParams.toString()),
    [rawSearchParams],
  );

  const currentRange: AnalyticsRange =
    (searchParams.get("range") as AnalyticsRange) ?? "30d";
  const currentGroupBy: AnalyticsGroupBy =
    (searchParams.get("groupBy") as AnalyticsGroupBy) ?? "day";
  const currentBreakdownBy: AnalyticsBreakdownBy =
    (searchParams.get("breakdownBy") as AnalyticsBreakdownBy) ?? "project";
  const currentIncludeOpen = searchParams.get("includeOpen") === "true";

  const navigate = useCallback(
    (key: string, value: string | null) => {
      const qs = buildFilterHref(searchParams, key, value);
      const href = `${pathname}${qs}`;
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [pathname, searchParams, router],
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
              onClick={() => navigate("range", r === "30d" ? null : r)}
              label={RANGE_LABELS[r]}
              active={currentRange === r}
              ariaCurrent={currentRange === r ? "page" : undefined}
              disabled={isPending}
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
              onClick={() => navigate("groupBy", g === "day" ? null : g)}
              label={GROUP_BY_LABELS[g]}
              active={currentGroupBy === g}
              ariaCurrent={currentGroupBy === g ? "page" : undefined}
              disabled={isPending}
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
              onClick={() => navigate("breakdownBy", b === "project" ? null : b)}
              label={BREAKDOWN_BY_LABELS[b]}
              active={currentBreakdownBy === b}
              ariaCurrent={currentBreakdownBy === b ? "page" : undefined}
              disabled={isPending}
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
            onClick={() => navigate("includeOpen", null)}
            label="Off"
            active={!currentIncludeOpen}
            ariaCurrent={!currentIncludeOpen ? "page" : undefined}
            disabled={isPending}
          />
          <FilterPill
            onClick={() => navigate("includeOpen", "true")}
            label="On"
            active={currentIncludeOpen}
            ariaCurrent={currentIncludeOpen ? "page" : undefined}
            disabled={isPending}
          />
        </div>
      </fieldset>
    </div>
  );
}
