import type {
  ApplicationResult,
  MoneyReserveProjection,
  MoneyState,
} from "@ega/application";

import { formatMad } from "./money-format";

type MoneyPrimarySummaryProps = {
  moneyState: MoneyState | null;
  reserve: ApplicationResult<MoneyReserveProjection> | null;
};

function unavailable(label: string, reason: string) {
  return (
    <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
      {label} unavailable — {reason}
    </span>
  );
}

/**
 * One primary financial summary. Cash, safe flexible money and the daily
 * reference are read from the canonical application projections; this component
 * never recalculates them. Missing inputs and failed reads are labeled
 * unavailable instead of rendered as a confirmed zero.
 */
export function MoneyPrimarySummary({ moneyState, reserve }: MoneyPrimarySummaryProps) {
  const cash = moneyState?.cash ?? null;
  const reserves = reserve?.ok && reserve.data.available ? reserve.data.reserves : null;
  const reserveCutoff = reserve?.ok && reserve.data.available ? reserve.data.cutoffDate : null;
  const reference = moneyState?.dayStartBaseline?.dailyReference ?? null;
  const safeFlexible = reserves?.safeFlexibleMinor ?? null;
  const negativeSafe = safeFlexible !== null && safeFlexible < 0;

  return (
    <section
      aria-labelledby="money-primary-summary-heading"
      className="mt-5 rounded-lg border border-ega-border p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="money-primary-summary-heading"
          className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]"
        >
          Spendable cash
        </h2>
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          {moneyState?.period
            ? `${moneyState.period.startDate}–${moneyState.period.endDate} · active ${moneyState.period.activeDate}`
            : "No tracking period configured"}
        </p>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div data-testid="money-recorded-cash-card">
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Recorded cash
          </dt>
          <dd className="mt-1 text-[length:var(--text-section)] font-semibold tabular-nums">
            {cash?.available ? (
              <span
                data-testid="money-recorded-cash"
                data-minor={cash.recordedCashMinor}
                data-cutoff={cash.cutoffDate}
                data-basis={cash.basis}
              >
                {formatMad(cash.recordedCashMinor)}
              </span>
            ) : (
              "Unavailable"
            )}
          </dd>
          <dd className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {cash?.available
              ? `Recorded basis through ${cash.cutoffDate}. Payment methods are metadata, not separate cash.`
              : unavailable("Recorded cash", cash?.reason ?? "Money state could not be loaded")}
          </dd>
        </div>

        <div data-testid="money-safe-to-spend-card">
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Safe to spend
          </dt>
          <dd
            className={`mt-1 text-[length:var(--text-section)] font-semibold tabular-nums ${negativeSafe ? "text-[color:var(--ega-danger)]" : ""}`}
          >
            {safeFlexible !== null ? (
              <span data-testid="money-safe-to-spend" data-minor={safeFlexible}>
                {formatMad(safeFlexible)}
              </span>
            ) : (
              "Unavailable"
            )}
          </dd>
          <dd className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {safeFlexible !== null
              ? negativeSafe
                ? `Recorded cash after unpaid commitments, unfunded savings and remaining emergency protection, through ${reserveCutoff}. Negative values stay visible.`
                : `Recorded cash after unpaid commitments, unfunded savings and remaining emergency protection, through ${reserveCutoff}. Funded savings stay separate.`
              : unavailable(
                  "Safe flexible cash",
                  reserve && !reserve.ok
                    ? "reserve inputs could not be loaded"
                    : "reserve inputs are incomplete",
                )}
          </dd>
        </div>

        <div data-testid="money-daily-reference-card">
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {reference?.available && reference.historical
              ? "Historical daily reference"
              : "Daily reference"}
          </dt>
          <dd className="mt-1 text-[length:var(--text-section)] font-semibold tabular-nums">
            {reference?.available ? (
              <span
                data-testid="money-daily-reference"
                data-minor={reference.referenceMinor}
                data-remaining={reference.dailyRemainingMinor}
              >
                {formatMad(reference.referenceMinor)}
              </span>
            ) : (
              "Unavailable"
            )}
          </dd>
          <dd className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {reference?.available ? (
              <>
                Day-start reference · remaining today{" "}
                <span data-testid="money-daily-remaining" data-minor={reference.dailyRemainingMinor}>
                  {formatMad(reference.dailyRemainingMinor)}
                </span>{" "}
                · {reference.daysRemaining} day{reference.daysRemaining === 1 ? "" : "s"} left ·{" "}
                {reference.algorithm}
                {reference.historical ? " · ended period, historical only" : ""}
              </>
            ) : (
              unavailable(
                "Daily reference",
                moneyState?.dayClosesUnavailable
                  ? "retained close evidence could not be loaded"
                  : "the day-start baseline or complete daily expense data is missing",
              )
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-4 rounded border border-ega-border p-3" data-testid="money-unverified-days">
        <h3 className="text-[length:var(--text-body)] font-semibold">Day verification</h3>
        {moneyState?.dayClosesUnavailable ? (
          <p role="status" className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Retained close evidence is unavailable right now; no “all verified” claim is made.
          </p>
        ) : moneyState?.period && (moneyState.unverifiedDayCount > 0 ? (
          <>
            <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              {moneyState.unverifiedDayCount} unverified/unclosed day
              {moneyState.unverifiedDayCount === 1 ? "" : "s"} through{" "}
              {moneyState.unverifiedThroughDate}. These dates are not zero and are not marked
              closed; day close remains optional.
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-[length:var(--text-meta)] underline">
                Show the unverified dates
              </summary>
              <p className="mt-2 break-words text-[length:var(--text-meta)] tabular-nums">
                {moneyState.unverifiedDates.join(", ")}
              </p>
            </details>
          </>
        ) : (
          <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            No skipped unverified days before the active date. Closing a day stays an explicit,
            optional attestation.
          </p>
        ))}
        {!moneyState?.period ? (
          <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Configure a period to track daily verification.
          </p>
        ) : null}
      </div>
    </section>
  );
}
