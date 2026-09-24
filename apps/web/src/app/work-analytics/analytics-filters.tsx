"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { FilterPill } from "@/components/ui/filter-pill";
import {
  buildFilterHref,
  DEFAULT_BREAKDOWN_BY,
  DEFAULT_GROUP_BY,
  DEFAULT_RANGE,
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

const SELECT_CLASS =
  "h-8 rounded-[var(--radius-sm)] border border-ega-border bg-ega-surface px-2 text-[length:var(--text-meta-lg)] font-medium text-ega-text transition-colors duration-[var(--duration-fast)] hover:border-ega-border-strong disabled:cursor-not-allowed disabled:opacity-50";

const FILTER_LABEL_CLASS =
  "text-[length:var(--text-meta)] font-medium text-ega-text-tertiary";

/**
 * Compact, URL-authoritative analytics filter toolbar.
 *
 * Range / Group by / Breakdown are visible selects (selected state always
 * visible); Include open sessions lives behind one disclosure. The URL remains
 * the single source of truth — no local state can disagree with it.
 */
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
    (searchParams.get("range") as AnalyticsRange) ?? DEFAULT_RANGE;
  const currentGroupBy: AnalyticsGroupBy =
    (searchParams.get("groupBy") as AnalyticsGroupBy) ?? DEFAULT_GROUP_BY;
  const currentBreakdownBy: AnalyticsBreakdownBy =
    (searchParams.get("breakdownBy") as AnalyticsBreakdownBy) ?? DEFAULT_BREAKDOWN_BY;
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
    <div
      className="relative flex flex-wrap items-center gap-x-3 gap-y-2"
      data-testid="analytics-filters"
      data-pending={isPending ? "true" : "false"}
    >
      <div className="flex items-center gap-1.5">
        <label htmlFor="analytics-filter-range" className={FILTER_LABEL_CLASS}>
          Range
        </label>
        <select
          id="analytics-filter-range"
          data-testid="analytics-filter-range"
          className={SELECT_CLASS}
          value={currentRange}
          disabled={isPending}
          onChange={(event) =>
            navigate("range", event.target.value === DEFAULT_RANGE ? null : event.target.value)
          }
        >
          {AVAILABLE_RANGES.map((r) => (
            <option key={r} value={r}>
              {RANGE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <label htmlFor="analytics-filter-group-by" className={FILTER_LABEL_CLASS}>
          Group by
        </label>
        <select
          id="analytics-filter-group-by"
          data-testid="analytics-filter-group-by"
          className={SELECT_CLASS}
          value={currentGroupBy}
          disabled={isPending}
          onChange={(event) =>
            navigate("groupBy", event.target.value === DEFAULT_GROUP_BY ? null : event.target.value)
          }
        >
          {AVAILABLE_GROUP_BYS.map((g) => (
            <option key={g} value={g}>
              {GROUP_BY_LABELS[g]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <label htmlFor="analytics-filter-breakdown" className={FILTER_LABEL_CLASS}>
          Breakdown
        </label>
        <select
          id="analytics-filter-breakdown"
          data-testid="analytics-filter-breakdown"
          className={SELECT_CLASS}
          value={currentBreakdownBy}
          disabled={isPending}
          onChange={(event) =>
            navigate(
              "breakdownBy",
              event.target.value === DEFAULT_BREAKDOWN_BY ? null : event.target.value,
            )
          }
        >
          {AVAILABLE_BREAKDOWN_BYS.map((b) => (
            <option key={b} value={b}>
              {BREAKDOWN_BY_LABELS[b]}
            </option>
          ))}
        </select>
      </div>

      <details className="relative">
        <summary
          className="filter-pill list-none [&::-webkit-details-marker]:hidden"
          data-testid="analytics-filter-more"
        >
          More filters{currentIncludeOpen ? " · open on" : ""}
        </summary>
        <div className="absolute right-0 z-30 mt-1 w-52 rounded-[var(--radius-lg)] border border-ega-border bg-ega-surface p-3 shadow-[var(--ega-shadow-md)]">
          <span className={FILTER_LABEL_CLASS}>Include open sessions</span>
          <div className="mt-2 flex flex-wrap gap-1">
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
        </div>
      </details>

      {/* Loading bar — visible during filter transitions */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 -bottom-1 h-0.5 overflow-hidden rounded-[var(--radius-pill)] bg-ega-border transition-opacity duration-200 ${
          isPending ? "opacity-100" : "opacity-0"
        }`}
      >
        <span
          className="block h-full w-1/3 rounded-[var(--radius-pill)] bg-ega-ink"
          style={{
            animation: isPending
              ? "loading-indeterminate 1.4s ease-in-out infinite"
              : "none",
          }}
        />
      </span>

      <style jsx>{`
        @keyframes loading-indeterminate {
          0% {
            transform: translateX(-100%);
          }
          60% {
            transform: translateX(300%);
          }
          100% {
            transform: translateX(300%);
          }
        }
      `}</style>
    </div>
  );
}
