import Link from "next/link";

import type { EvidenceReviewResult } from "@ega/application";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function formatMad(minor: number): string {
  return new Intl.NumberFormat("fr-MA", {
    style: "currency",
    currency: "MAD",
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

/**
 * Two-week evidence review (PO-12, issue #353). Every metric discloses its
 * coverage; unknown days are stated, never filled with invented history.
 * Saved review notes stay in the weekly authority — this is read-only.
 */
export function EvidenceReviewPanel({ data }: { data: EvidenceReviewResult }) {
  const { range, work, runs, leisure, overtime, money, coverage, suggestions } = data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence review</CardTitle>
        <CardDescription>
          {range.startLocalDate} to {range.endLocalDate} · {range.timezone} · {range.totalDays} days.
          Only recorded evidence appears here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section aria-label="Work and search evidence">
          {work ? (
            <p className="text-[length:var(--text-body)]">
              Work {formatMinutes(Math.floor(work.trackedSeconds / 60))} against {formatMinutes(work.workTargetMinutes)} target.
              {" "}
              {work.jobSearchConfigured
                ? `Job search inside that total: ${formatMinutes(Math.floor(work.jobSearchSeconds / 60))} / ${formatMinutes(work.jobSearchTargetMinutes)}.`
                : "Job search is not configured for this period."}
            </p>
          ) : (
            <p className="text-[length:var(--text-body)]">Work evidence unavailable right now.</p>
          )}
        </section>

        <section aria-label="Routine evidence" className="flex flex-col gap-1.5">
          <p className="text-[length:var(--text-body)]">
            Runs {runs.sessions}/{runs.sessionsTarget} ({runs.minutes}m recorded).
          </p>
          <p className="text-[length:var(--text-body)]">
            Leisure {formatMinutes(leisure.totalMinutes)} across {leisure.recordedDays} recorded day{leisure.recordedDays === 1 ? "" : "s"};
            {" "}{leisure.unknownDays} day{leisure.unknownDays === 1 ? "" : "s"} unknown (not zero).
          </p>
          <p className="text-[length:var(--text-body)]">
            Overtime {overtime.evenings} evening{overtime.evenings === 1 ? "" : "s"} ({overtime.reasonedEvenings} reasoned, {overtime.unreasonedEvenings} without a reason).
          </p>
          {coverage.checkinDays < range.totalDays ? (
            <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Check-ins cover {coverage.checkinDays} of {range.totalDays} days; sleep recorded on {coverage.sleepRecordedDays}.
            </p>
          ) : null}
        </section>

        <section aria-label="Money evidence">
          {money ? (
            <p className="text-[length:var(--text-body)]">
              Recorded spending {formatMad(money.totalMinor)} ({money.recordCount} expenses), coffee {formatMad(money.coffeeMinor)}{money.truncated ? " — lower bound (capped read)" : ""}.
              {" "}
              <Link className="underline" href="/money">
                Open Money
              </Link>
            </p>
          ) : (
            <p className="text-[length:var(--text-body)]">Money evidence unavailable right now.</p>
          )}
        </section>

        <section aria-label="Suggestions">
          <ul className="flex flex-col gap-1.5">
            {suggestions.map((suggestion) => (
              <li key={suggestion} className="text-[length:var(--text-body)]">
                • {suggestion}
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
