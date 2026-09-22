"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
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
 * Selected state always remains visible and the URL is the single source of truth.
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
    (searchParams.get("breakdownBy") as AnalyticsBreakdownBy) ??
    DEFAULT_BREAKDOWN_BY;
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
            navigate(
              "range",
              event.target.value === DEFAULT_RANGE ? null : event.target.value,
            )
          }
        >
          {AVAILABLE_RANGES.map((range) => (
            <option key={range} value={range}>
              {RANGE_LABELS[range]}
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
            navigate(
              "groupBy",
              event.target.value === DEFAULT_GROUP_BY ? null : event.target.value,
            )
          }
        >
          {AVAILABLE_GROUP_BYS.map((groupBy) => (
            <option key={groupBy} value={groupBy}>
              {GROUP_BY_LABELS[groupBy]}
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
              event.target.value === DEFAULT_BREAKDOWN_BY
                ? null
                : event.target.value,
            )
          }
        >
          {AVAILABLE_BREAKDOWN_BYS.map((breakdownBy) => (
            <option key={breakdownBy} value={breakdownBy}>
              {BREAKDOWN_BY_LABELS[breakdownBy]}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={`analytics-open-toggle ${currentIncludeOpen ? "is-active" : ""}`}
        data-testid="analytics-filter-more"
        aria-pressed={currentIncludeOpen}
        disabled={isPending}
        onClick={() => navigate("includeOpen", currentIncludeOpen ? null : "true")}
      >
        <span>Open sessions</span>
        <strong>{currentIncludeOpen ? "On" : "Off"}</strong>
      </button>

      <div className="analytics-filter-progress" aria-hidden="true">
        <div
          className={`analytics-filter-progress-bar ${isPending ? "is-pending" : ""}`}
        />
      </div>

      <style jsx>{`
        @keyframes analytics-loading-indeterminate {
          0% {
            transform: translateX(-120%);
          }
          60% {
            transform: translateX(310%);
          }
          100% {
            transform: translateX(310%);
          }
        }

        .analytics-filter-progress-bar.is-pending {
          animation: analytics-loading-indeterminate 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
