import { compareEstimateToTracked } from "@ega/application/timer/tracked-time";

import { Badge } from "@/components/ui/badge";
import { formatDisplayDuration, formatDisplayEstimate } from "@/lib/presentation-format";
import { cn } from "@/lib/utils";

type EstimateVsActualBadgeProps = {
  /** Task/project estimate in minutes. No estimate means no comparison. */
  estimateMinutes: number | null | undefined;
  /**
   * Canonical tracked seconds (timer session total). `null`/`undefined` means
   * the total is unavailable, not zero: render nothing rather than a fake 0.
   */
  trackedSeconds: number | null | undefined;
  /**
   * A running session is included, so the total is still moving. The value is
   * server-rendered; this badge does not tick.
   */
  hasOpenSession?: boolean;
  className?: string;
};

const STATE_TONE = {
  over: "warn",
  under: "info",
  on_target: "muted",
} as const;

const STATE_LABEL = {
  over: "over estimate",
  under: "under estimate",
  on_target: "on estimate",
} as const;

/**
 * Estimate vs actual for one task or one project aggregate.
 *
 * The read model owns the numbers and the over/under rule; this component only
 * formats them. Static text keeps it usable with touch and keyboard without a
 * focus target, and it has no motion to reduce.
 *
 * Shown only when the item has an estimate (acceptance criterion).
 */
export function EstimateVsActualBadge({
  estimateMinutes,
  trackedSeconds,
  hasOpenSession = false,
  className,
}: EstimateVsActualBadgeProps) {
  if (trackedSeconds === null || trackedSeconds === undefined) return null;

  const comparison = compareEstimateToTracked({
    estimateMinutes,
    trackedSeconds,
    hasOpenSession,
  });
  if (!comparison) return null;

  const estimateLabel = formatDisplayEstimate(comparison.estimateMinutes);
  const trackedLabel = formatDisplayDuration(comparison.trackedSeconds, "minute");
  const percentLabel =
    comparison.percent === null
      ? null
      : `${comparison.percent > 0 ? "+" : ""}${comparison.percent}%`;
  const stateLabel = STATE_LABEL[comparison.state];

  const visibleDetail =
    comparison.percent !== null && comparison.percent !== 0
      ? percentLabel
      : stateLabel;

  return (
    <Badge
      tone={STATE_TONE[comparison.state]}
      className={cn("shrink-0 tabular-nums", className)}
      data-testid="estimate-vs-actual"
      data-state={comparison.state}
    >
      <span>
        {estimateLabel} est · {trackedLabel} tracked
        {visibleDetail ? `, ${visibleDetail}` : ""}
        {comparison.hasOpenSession ? " · running" : ""}
      </span>
      <span className="sr-only">
        {` ${stateLabel}`}
        {comparison.percent !== null && comparison.percent !== 0
          ? ` by ${Math.abs(comparison.deltaMinutes)} minutes`
          : ""}
        {comparison.hasOpenSession ? ", including a running timer session" : ""}
      </span>
    </Badge>
  );
}
