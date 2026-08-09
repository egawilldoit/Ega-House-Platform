"use client";

type TodayScheduledTimeRangeProps = {
  startAt: string;
  endAt: string;
};

function formatLocalTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function TodayScheduledTimeRange({ startAt, endAt }: TodayScheduledTimeRangeProps) {
  const startLabel = formatLocalTime(startAt);
  const endLabel = formatLocalTime(endAt);

  if (!startLabel || !endLabel) {
    return null;
  }

  return (
    <p className="mt-2 text-xs font-medium uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
      Scheduled {startLabel}-{endLabel}
    </p>
  );
}
