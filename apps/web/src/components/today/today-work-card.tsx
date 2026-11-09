import Link from "next/link";

import type { OperatorWorkToday } from "@ega/application";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export type TodayMoneySummary = Readonly<{
  available: boolean;
  totalMinor: number | null;
}>;

export type TodayRoutineSummary = Readonly<{
  available: boolean;
  saved: boolean;
}>;

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function formatSeconds(seconds: number): string {
  return formatMinutes(Math.floor(seconds / 60));
}

function formatMad(minor: number): string {
  return new Intl.NumberFormat("fr-MA", {
    style: "currency",
    currency: "MAD",
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

type TodayWorkCardProps = {
  work: OperatorWorkToday | null;
  money: TodayMoneySummary;
  routine: TodayRoutineSummary;
};

/**
 * Unified Today work/life cards (PO-01, issue #352). Every source is honest:
 * an unavailable source says so instead of rendering a fake zero, and a
 * successful read with no records says "not recorded yet".
 */
export function TodayWorkCard({ work, money, routine }: TodayWorkCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Work, money and routine</CardTitle>
        <CardDescription>
          One glance at today — each card draws from its canonical source.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section aria-label="Work progress">
          {work ? (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-[length:var(--text-meta-lg)] font-medium">
                {formatSeconds(work.trackedSeconds)} tracked / {formatMinutes(work.workTargetMinutes)} target
              </p>
              <Link className="underline" href="/work-analytics">
                Work analytics
              </Link>
              <p className="w-full text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                {work.jobSearchConfigured
                  ? `Job search inside that total: ${formatSeconds(work.jobSearchSeconds)} / ${formatMinutes(work.jobSearchTargetMinutes)} target.`
                  : "Job search is not configured yet — no search minutes counted."}
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-[length:var(--text-meta-lg)]">Work progress unavailable right now.</p>
              <Link className="underline" href="/work-analytics">
                Work analytics
              </Link>
            </div>
          )}
        </section>

        <section aria-label="Today spending">
          {money.available ? (
            money.totalMinor !== null && money.totalMinor > 0 ? (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="text-[length:var(--text-meta-lg)] font-medium">
                  {formatMad(money.totalMinor)} recorded today
                </p>
                <Link className="underline" href="/money">
                  Open Money
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="text-[length:var(--text-meta-lg)]">No spending recorded today yet.</p>
                <Link className="underline" href="/money">
                  Open Money
                </Link>
              </div>
            )
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-[length:var(--text-meta-lg)]">Money unavailable right now.</p>
              <Link className="underline" href="/money">
                Open Money
              </Link>
            </div>
          )}
        </section>

        <section aria-label="Routine check-in">
          {routine.available ? (
            routine.saved ? (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="text-[length:var(--text-meta-lg)] font-medium">Check-in saved for today.</p>
                <Link className="underline" href="/shutdown">
                  Open Shutdown
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="text-[length:var(--text-meta-lg)]">No check-in yet — two minutes at Shutdown.</p>
                <Link className="underline" href="/shutdown">
                  Open Shutdown
                </Link>
              </div>
            )
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-[length:var(--text-meta-lg)]">Check-in status unavailable right now.</p>
              <Link className="underline" href="/shutdown">
                Open Shutdown
              </Link>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
