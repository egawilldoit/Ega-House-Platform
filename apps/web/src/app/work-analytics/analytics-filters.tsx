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
    <div className="analytics-filter-controls analytics-filter-controls-compact">
      <label className="analytics-filter-field">
        <span className="analytics-filter-label">Range</span>
        <select
          className="analytics-filter-select"
          data-testid="analytics-filter-range"
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
      </label>

      <label className="analytics-filter-field">
        <span className="analytics-filter-label">Group by</span>
        <select
          className="analytics-filter-select"
          data-testid="analytics-filter-group-by"
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
      </label>

      <label className="analytics-filter-field">
        <span className="analytics-filter-label">Breakdown</span>
        <select
          className="analytics-filter-select"
          data-testid="analytics-filter-breakdown"
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
      </label>

      <details className="analytics-filter-more">
        <summary className="analytics-filter-more-trigger" data-testid="analytics-filter-more">
          More filters{currentIncludeOpen ? " · open sessions on" : ""}
        </summary>
        <div className="analytics-filter-more-panel">
          <span className="analytics-filter-label">Include open sessions</span>
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
        </div>
      </details>

      {/* Loading bar — visible during filter transitions */}
      <div
        className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--border)] transition-opacity duration-200"
        aria-hidden="true"
      >
        <div
          className={`h-full w-1/3 rounded-full bg-[var(--signal-live)] transition-all duration-500 ${
            isPending ? "opacity-100" : "opacity-0"
          }`}
          style={{
            animation: isPending
              ? "loading-indeterminate 1.4s ease-in-out infinite"
              : "none",
          }}
        />
      </div>

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
