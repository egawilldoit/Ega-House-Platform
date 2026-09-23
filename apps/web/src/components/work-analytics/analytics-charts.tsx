"use client";

import { useEffect, useRef, useState } from "react";

import { formatDurationLabel } from "@/lib/task-session";
import { cn } from "@/lib/utils";
import type { WorkAnalyticsDaily } from "@/lib/services/work-analytics-service";

/**
 * Inline-SVG chart grammar for the analytics workspace.
 *
 * Only tokens from styles/tokens.css are used: soft bars, a 2px data-blue line,
 * 1px divider gridlines and 10px tertiary labels. Every chart carries an
 * accessible name and an `sr-only` table equivalent; no chart library.
 */

const VIEW_WIDTH = 720;
const DEFAULT_HEIGHT = 220;
const PAD_TOP = 12;
const PAD_RIGHT = 12;
const PAD_BOTTOM = 26;
const PAD_LEFT = 46;
const GRID_TICKS = 4;

const ALLOCATION_COLORS = [
  "var(--ega-data-blue)",
  "var(--ega-data-orange)",
  "var(--ega-data-green)",
  "var(--ega-data-purple)",
  "var(--ega-data-yellow)",
  "var(--ega-data-slate)",
] as const;

function toIsoUtcDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * Measures the chart container so the SVG viewBox matches rendered pixels.
 * This keeps 10px labels and 2px lines undistorted at any panel width.
 */
function useChartWidth() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(VIEW_WIDTH);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const update = () => {
      const measured = Math.round(node.getBoundingClientRect().width);
      if (measured > 0) setWidth(Math.max(280, measured));
    };

    update();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { containerRef, width };
}

function formatAxisMinutes(minutes: number) {
  if (minutes <= 0) return "0";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function formatBucketLabel(date: string) {
  return toIsoUtcDate(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatBucketLabelLong(date: string) {
  return toIsoUtcDate(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type TrendChartPoint = {
  date: string;
  workedMinutes: number;
  sessionCount: number;
  centerX: number;
  y: number;
  barX: number;
  barWidth: number;
  barY: number;
};

type FocusTrendChartProps = {
  data: WorkAnalyticsDaily[];
  ariaLabel: string;
  tableCaption: string;
  /** "bars" draws the daily bars (optionally with a trend line); "line" draws an area trend. */
  variant?: "bars" | "line";
  showTrendLine?: boolean;
  /**
   * Second dimension for the trend line. When omitted no line is drawn: the
   * line previously re-plotted the bar values, which added no information.
   * Supply a derived series such as a trailing average.
   */
  trendData?: WorkAnalyticsDaily[];
  trendLabel?: string;
  height?: number;
  className?: string;
  onBucketClick?: (date: string, label: string) => void;
};

export function FocusTrendChart({
  data,
  ariaLabel,
  tableCaption,
  variant = "bars",
  showTrendLine = false,
  trendData,
  trendLabel,
  height = DEFAULT_HEIGHT,
  className,
  onBucketClick,
}: FocusTrendChartProps) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const { containerRef, width: chartWidth } = useChartWidth();

  const maxMinutes = data.reduce((max, item) => Math.max(max, item.workedMinutes), 0);

  if (data.length === 0 || maxMinutes <= 0) {
    return (
      <div className="px-1 py-6 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
        No tracked time in this window yet. Start a timer to build trend data.
      </div>
    );
  }

  const plotWidth = chartWidth - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;
  const band = plotWidth / data.length;
  const barWidth = Math.max(3, Math.min(30, band * 0.52));

  const points: TrendChartPoint[] = data.map((item, index) => {
    const ratio = maxMinutes > 0 ? item.workedMinutes / maxMinutes : 0;
    const y = PAD_TOP + plotHeight - ratio * plotHeight;
    const barY = Math.min(y, PAD_TOP + plotHeight - 1);
    return {
      date: item.date,
      workedMinutes: item.workedMinutes,
      sessionCount: item.sessionCount,
      centerX: PAD_LEFT + band * index + band / 2,
      y,
      barX: PAD_LEFT + band * index + (band - barWidth) / 2,
      barWidth,
      barY,
    };
  });

  const hasTrendSeries =
    Array.isArray(trendData) && trendData.length === data.length && trendData.some((entry) => entry.workedMinutes > 0);

  const trendPoints = hasTrendSeries
    ? (trendData as WorkAnalyticsDaily[]).map((item, index) => {
        const ratio = maxMinutes > 0 ? item.workedMinutes / maxMinutes : 0;
        return {
          centerX: points[index]?.centerX ?? PAD_LEFT,
          y: PAD_TOP + plotHeight - ratio * plotHeight,
        };
      })
    : [];

  const linePath = trendPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.y}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1]?.centerX ?? PAD_LEFT} ${
    PAD_TOP + plotHeight
  } L ${points[0]?.centerX ?? PAD_LEFT} ${PAD_TOP + plotHeight} Z`;

  const ticks = Array.from({ length: GRID_TICKS + 1 }, (_, index) => {
    const value = (maxMinutes / GRID_TICKS) * index;
    const y = PAD_TOP + plotHeight - (value / maxMinutes) * plotHeight;
    return { value, y };
  });

  const labelStep = Math.max(1, Math.ceil(data.length / 8));
  const activePoint = points.find((point) => point.date === activeDate) ?? null;
  const interactive = Boolean(onBucketClick);

  const activate = (date: string, label: string) => {
    if (!onBucketClick) return;
    onBucketClick(date, label);
  };

  return (
    <figure className={cn("chart-figure", className)}>
      <div className="relative" ref={containerRef}>
        <svg
          className="chart-svg"
          viewBox={`0 0 ${chartWidth} ${height}`}
          role="img"
          aria-label={ariaLabel}
        >
          {ticks.map((tick) => (
            <line
              key={tick.value}
              className="chart-grid-line"
              x1={PAD_LEFT}
              x2={chartWidth - PAD_RIGHT}
              y1={tick.y}
              y2={tick.y}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            className="chart-baseline"
            x1={PAD_LEFT}
            x2={chartWidth - PAD_RIGHT}
            y1={PAD_TOP + plotHeight}
            y2={PAD_TOP + plotHeight}
            vectorEffect="non-scaling-stroke"
          />

          {ticks.map((tick) => (
            <text
              key={`axis-${tick.value}`}
              className="chart-label"
              x={PAD_LEFT - 8}
              y={tick.y + 3}
              textAnchor="end"
            >
              {formatAxisMinutes(tick.value)}
            </text>
          ))}

          {variant === "bars"
            ? points.map((point) => {
                const active = point.date === activeDate;
                return (
                  <rect
                    key={point.date}
                    className={active ? "chart-bar-active" : "chart-bar"}
                    x={point.barX}
                    y={point.barY}
                    width={point.barWidth}
                    height={PAD_TOP + plotHeight - point.barY}
                    rx={3}
                    stroke={active ? "var(--ega-text)" : "none"}
                    strokeWidth={active ? 1 : 0}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })
            : null}

          {variant === "line" ? (
            <>
              <path className="chart-area" d={areaPath} />
              <path className="chart-line" d={linePath} vectorEffect="non-scaling-stroke" />
              {points.map((point) => (
                <circle
                  key={point.date}
                  className={point.date === activeDate ? "chart-bar-active" : "chart-bar"}
                  cx={point.centerX}
                  cy={point.y}
                  r={point.date === activeDate ? 5 : 3}
                  stroke="var(--ega-surface)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          ) : null}

          {showTrendLine && variant === "bars" && trendPoints.length > 1 ? (
            <path
              className="chart-line"
              d={linePath}
              vectorEffect="non-scaling-stroke"
              data-testid="chart-trend-line"
            >
              {trendLabel ? <title>{trendLabel}</title> : null}
            </path>
          ) : null}

          {/* Hit targets: full-height bands keep keyboard and pointer access reliable. */}
          {points.map((point, index) => {
            const active = point.date === activeDate;
            return (
              <g
                key={`hit-${point.date}`}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={`${formatBucketLabelLong(point.date)}: ${formatDurationLabel(
                  point.workedMinutes * 60,
                )}, ${point.sessionCount} session${point.sessionCount === 1 ? "" : "s"}`}
                className={cn(
                  "outline-none",
                  interactive && "cursor-pointer",
                  active && "opacity-100",
                )}
                onMouseEnter={() => setActiveDate(point.date)}
                onMouseLeave={() => setActiveDate(null)}
                onFocus={() => setActiveDate(point.date)}
                onBlur={() => setActiveDate(null)}
                onClick={() => activate(point.date, formatBucketLabel(point.date))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate(point.date, formatBucketLabel(point.date));
                  }
                }}
              >
                <rect
                  x={PAD_LEFT + band * index}
                  y={PAD_TOP}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                />
              </g>
            );
          })}

          {points.map((point, index) =>
            index % labelStep === 0 ? (
              <text
                key={`label-${point.date}`}
                className="chart-label"
                x={point.centerX}
                y={height - 8}
                textAnchor="middle"
              >
                {formatBucketLabel(point.date)}
              </text>
            ) : null,
          )}
        </svg>

        {activePoint ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[var(--radius-sm)] border border-ega-border bg-ega-surface px-3 py-2 text-[length:var(--text-meta)] shadow-[var(--ega-shadow-md)]"
            style={{
              left: `${(activePoint.centerX / chartWidth) * 100}%`,
              top: `${(Math.max(activePoint.y, PAD_TOP) / height) * 100}%`,
            }}
          >
            <p className="font-medium text-ega-text">{formatBucketLabelLong(activePoint.date)}</p>
            <p className="tabular-nums text-ega-text-secondary">
              {formatDurationLabel(activePoint.workedMinutes * 60)} · {activePoint.sessionCount}{" "}
              session{activePoint.sessionCount === 1 ? "" : "s"}
            </p>
            {onBucketClick ? (
              <p className="text-ega-text-tertiary">Select to open sessions</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <table className="sr-only">
        <caption>{tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Focused time</th>
            <th scope="col">Sessions</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={item.date}>
              <th scope="row">{item.date}</th>
              <td>{formatDurationLabel(item.workedMinutes * 60)}</td>
              <td>{item.sessionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export type AllocationSegment = {
  key: string;
  label: string;
  value: number;
  detail: string;
  onSelect?: () => void;
};

type AllocationDonutProps = {
  segments: AllocationSegment[];
  totalLabel: string;
  ariaLabel: string;
  emptyMessage: string;
  maxSegments?: number;
  className?: string;
};

export function AllocationDonut({
  segments,
  totalLabel,
  ariaLabel,
  emptyMessage,
  maxSegments = 6,
  className,
}: AllocationDonutProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (segments.length === 0 || total <= 0) {
    return (
      <p className={cn("py-6 text-center text-[length:var(--text-meta-lg)] text-ega-text-secondary", className)}>
        {emptyMessage}
      </p>
    );
  }

  const visible = segments.slice(0, maxSegments);
  const rest = segments.slice(maxSegments);
  const restValue = rest.reduce((sum, segment) => sum + segment.value, 0);
  const chartSegments = restValue > 0
    ? [
        ...visible,
        {
          key: "__other__",
          label: "Other",
          value: restValue,
          detail: formatDurationLabel(restValue * 60),
          onSelect: undefined,
        },
      ]
    : visible;

  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  const donutSegments: {
    key: string;
    stroke: string;
    dash: number;
    dashOffset: number;
    onSelect?: () => void;
  }[] = [];
  let offset = 0;
  for (const [index, segment] of chartSegments.entries()) {
    const dash = (segment.value / total) * circumference;
    donutSegments.push({
      key: segment.key,
      stroke: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
      dash,
      dashOffset: -offset,
      onSelect: segment.onSelect,
    });
    offset += dash;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-4", className)}>
      <div className="relative mx-auto h-36 w-36 shrink-0" role="img" aria-label={ariaLabel}>
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle
            cx={70}
            cy={70}
            r={radius}
            fill="none"
            stroke="var(--ega-surface-muted)"
            strokeWidth={18}
          />
          {donutSegments.map((segment) => (
            <circle
              key={segment.key}
              cx={70}
              cy={70}
              r={radius}
              fill="none"
              stroke={segment.stroke}
              strokeWidth={18}
              strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
              strokeDashoffset={segment.dashOffset}
              className={segment.onSelect ? "cursor-pointer" : undefined}
              onClick={segment.onSelect}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[length:var(--text-meta)] text-ega-text-tertiary">Total</span>
          <span className="text-[length:var(--text-body-lg)] font-semibold tabular-nums text-ega-text">
            {totalLabel}
          </span>
        </div>
      </div>

      <ul className="flex min-w-[13rem] flex-1 flex-col gap-1">
        {chartSegments.map((segment, index) => {
          const row = (
            <>
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }}
              />
              <span
                className="line-clamp-2 min-w-0 flex-1 break-words text-left text-ega-text-secondary"
                title={segment.label}
              >
                {segment.label}
              </span>
              <span className="shrink-0 tabular-nums font-medium text-ega-text">
                {segment.detail}
              </span>
            </>
          );

          return (
            <li key={segment.key}>
              {segment.onSelect ? (
                <button
                  type="button"
                  onClick={segment.onSelect}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-[length:var(--text-meta-lg)] hover:bg-ega-surface-hover"
                >
                  {row}
                </button>
              ) : (
                <div className="flex w-full items-center gap-2 px-1.5 py-1 text-[length:var(--text-meta-lg)]">
                  {row}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type WeekdayDistributionChartProps = {
  data: Array<{ weekday: number; label: string; workedMinutes: number; sessionCount: number }>;
  ariaLabel: string;
  tableCaption: string;
  height?: number;
  className?: string;
};

/**
 * Weekday distribution of focus time.
 *
 * A distinct dimension from any period chart: it answers which weekdays carry
 * the work. Values come from the canonical series aggregation.
 */
export function WeekdayDistributionChart({
  data,
  ariaLabel,
  tableCaption,
  height = 160,
  className,
}: WeekdayDistributionChartProps) {
  const maxMinutes = data.reduce((max, entry) => Math.max(max, entry.workedMinutes), 0);

  if (data.length === 0 || maxMinutes <= 0) {
    return (
      <div className="px-1 py-6 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
        No tracked time in this window yet. Start a timer to build weekday patterns.
      </div>
    );
  }

  const plotHeight = height - PAD_TOP - PAD_BOTTOM;
  const plotWidth = 100;
  const band = plotWidth / data.length;
  const barWidth = band * 0.5;

  return (
    <figure className={cn("chart-figure", className)}>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="chart-svg"
        style={{ height }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            className="chart-grid-line"
            x1={0}
            x2={100}
            y1={PAD_TOP + plotHeight * (1 - ratio)}
            y2={PAD_TOP + plotHeight * (1 - ratio)}
          />
        ))}
        {data.map((entry, index) => {
          const ratio = entry.workedMinutes / maxMinutes;
          const barHeight = Math.max(1, ratio * plotHeight);
          return (
            <rect
              key={entry.label}
              className="chart-bar"
              x={band * index + (band - barWidth) / 2}
              y={PAD_TOP + plotHeight - barHeight}
              width={barWidth}
              height={barHeight}
            />
          );
        })}
      </svg>
      <div className="flex justify-between text-[length:var(--text-micro)] text-[color:var(--ega-text-tertiary)]">
        {data.map((entry) => (
          <span key={entry.label} className="flex-1 text-center">
            {entry.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">Weekday</th>
            <th scope="col">Focused time</th>
            <th scope="col">Sessions</th>
          </tr>
        </thead>
        <tbody>
          {data.map((entry) => (
            <tr key={entry.label}>
              <th scope="row">{entry.label}</th>
              <td>{formatDurationLabel(entry.workedMinutes * 60)}</td>
              <td>{entry.sessionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="chart-caption">{tableCaption}</figcaption>
    </figure>
  );
}
