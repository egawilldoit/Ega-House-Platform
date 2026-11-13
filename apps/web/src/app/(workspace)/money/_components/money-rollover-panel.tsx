"use client";

import { useState } from "react";

import type { MoneyRolloverPreview } from "@ega/application";
import { formatMinorToMad } from "@/lib/money/money-amount";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

type MoneyFormActionResult =
  | { ok: true; error: null }
  | { ok: false; error: string };

type MoneyRolloverPanelProps = {
  preview: MoneyRolloverPreview | null;
  previewUnavailableReason: string | null;
  action: (formData: FormData) => Promise<MoneyFormActionResult>;
};

/**
 * Explicit period rollover. The successor dates are the documented defaults
 * (the day after the source ends, same inclusive length); custom dates are
 * available through MCP. The form never closes a day and never edits the
 * source period, and it requires the owner to resolve unpaid occurrences and a
 * modeled-versus-verified cash difference before the write.
 */
export function MoneyRolloverPanel({
  preview,
  previewUnavailableReason,
  action,
}: MoneyRolloverPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [openingMode, setOpeningMode] = useState<"carry_forward" | "verified_source">(
    preview?.openingMode ?? "carry_forward",
  );
  // One stable operation id per rendered form; a retry of the same confirmed
  // request replays instead of creating a second successor.
  const [operationId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `rollover-${Date.now()}`,
  );

  if (!preview) {
    return (
      <section
        aria-labelledby="money-rollover-heading"
        className="mt-6 rounded-lg border border-ega-border p-5"
      >
        <h2 id="money-rollover-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
          Period rollover
        </h2>
        <p role="status" className="mt-2 text-[color:var(--ega-text-secondary)]">
          {previewUnavailableReason ??
            "The successor preview is unavailable right now, so rollover cannot be confirmed."}
        </p>
      </section>
    );
  }

  const pending = preview.pendingOccurrences;
  const difference = preview.reconciliation.differenceMinor;

  async function submit(formData: FormData) {
    setError(null);
    const result = await action(formData);
    if (!result.ok) setError(result.error);
  }

  return (
    <section
        aria-labelledby="money-rollover-heading"
        className="mt-6 rounded-lg border border-ega-border p-5"
      >
      <h2 id="money-rollover-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
        Period rollover
      </h2>
      <p className="mt-2 text-[color:var(--ega-text-secondary)]">
        {preview.source.startDate}–{preview.source.endDate} is finished. Rollover
        creates one successor for {preview.targets.startDate}–{preview.targets.endDate} (
        {preview.targets.inclusiveDays} days) and keeps the old period selectable.
        Unused daily allowance is not carried forward.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Modeled closing cash
          </dt>
          <dd className="font-medium">
            {preview.modeledClosingCashMinor === null
              ? "Unknown"
              : formatMinorToMad(preview.modeledClosingCashMinor)}
          </dd>
        </div>
        <div>
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Unpaid occurrences
          </dt>
          <dd className="font-medium">
            {pending.length} · {formatMinorToMad(preview.reconciliation.pendingOccurrenceMinor)}
          </dd>
        </div>
        <div>
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Regenerated occurrences
          </dt>
          <dd className="font-medium">{preview.generatedObligations.length}</dd>
        </div>
        <div>
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Closing difference
          </dt>
          <dd className="font-medium">
            {difference === null
              ? "Not supplied"
              : formatMinorToMad(difference)}
          </dd>
        </div>
        <div>
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Day closes compared
          </dt>
          <dd className="font-medium">
            {preview.closeSnapshots.available
              ? preview.closeSnapshots.comparableToRestatedTotals
                ? `${preview.closeSnapshots.closeCount}/${preview.closeSnapshots.requiredCloseCount} · ${preview.closeSnapshots.restatedDifferenceCount} restated`
                : `${preview.closeSnapshots.closeCount} · comparison unavailable`
              : "Unavailable"}
          </dd>
        </div>
      </dl>

      {preview.reconciliation.differences.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          {preview.reconciliation.differences.map((entry) => (
            <li key={entry.code}>
              <span className="font-medium">{entry.code.replaceAll("_", " ")}:</span>{" "}
              {entry.message}
            </li>
          ))}
        </ul>
      ) : null}

      {preview.priorCorrectionBridges.some((bridge) => !bridge.applied) ? (
        <div className="mt-3 rounded border border-ega-border p-3">
          <h3 className="font-medium">Historical correction variances</h3>
          <ul className="mt-1 flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {preview.priorCorrectionBridges
              .filter((bridge) => !bridge.applied)
              .map((bridge) => (
                <li key={bridge.id}>
                  {bridge.amountMinor} centimes {bridge.direction === "in" ? "in" : "out"} on{" "}
                  {bridge.bookingDate} — {bridge.varianceReason?.replaceAll("_", " ")}. The
                  independently verified opening was not altered.
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {preview.blockers.length > 0 ? (
        <ul role="alert" className="feedback-block feedback-block-error mt-3 flex flex-col gap-1">
          {preview.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}

      {preview.choices.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-[color:var(--ega-text-secondary)]">
          {preview.choices.map((choice) => (
            <li key={choice}>{choice}</li>
          ))}
        </ul>
      ) : null}

      <form action={submit} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="periodId" value={preview.source.periodId} />
        <input type="hidden" name="version" value={preview.source.version} />
        <input type="hidden" name="startDate" value={preview.targets.startDate} />
        <input type="hidden" name="endDate" value={preview.targets.endDate} />
        <input type="hidden" name="operationId" value={operationId} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rollover-opening-mode" className="form-label">
              Successor opening
            </label>
            <select
              id="rollover-opening-mode"
              name="openingMode"
              className="input-instrument"
              value={openingMode}
              onChange={(event) =>
                setOpeningMode(event.target.value as "carry_forward" | "verified_source")
              }
            >
              <option value="carry_forward">Carry forward modeled closing cash</option>
              <option value="verified_source">Use an independently verified balance</option>
            </select>
          </div>
          {pending.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rollover-unpaid" className="form-label">
                Unpaid occurrences
              </label>
              <select
                id="rollover-unpaid"
                name="unpaidTreatment"
                className="input-instrument"
                defaultValue="keep_pending"
              >
                <option value="keep_pending">Keep them in the finished period</option>
                <option value="carry_forward">Carry one-off bills into the successor</option>
                <option value="cancel">Cancel them explicitly</option>
              </select>
            </div>
          ) : null}
        </div>

        {pending.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rollover-unpaid-reason" className="form-label">
              Unpaid-item reason (required to carry or cancel)
            </label>
            <Input id="rollover-unpaid-reason" name="unpaidReason" placeholder="Why this treatment is correct" />
          </div>
        ) : null}

        {openingMode === "verified_source" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rollover-verified-amount" className="form-label">
                Verified balance (MAD)
              </label>
              <Input id="rollover-verified-amount" name="verifiedAmount" inputMode="decimal" placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rollover-verified-cutoff" className="form-label">
                Balance date
              </label>
              <Input id="rollover-verified-cutoff" name="verifiedCutoffDate" type="date" />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="rollover-verified-evidence" className="form-label">
                Evidence
              </label>
              <Input id="rollover-verified-evidence" name="verifiedEvidence" placeholder="Statement or counted-cash reference" />
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="rollover-difference-note" className="form-label">
            Accept any closing/restatement difference (retained as provenance)
          </label>
          <Input id="rollover-difference-note" name="acceptClosingDifferenceNote" placeholder="Required when the verified balance differs, a close was restated, or a payment/visit mismatch is accepted" />
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Required before confirming a modeled-versus-verified cash difference, a
            restated day close, or an accepted paid-obligation/counted-visit mismatch.
          </p>
        </div>

        {error ? (
          <p role="alert" className="feedback-block feedback-block-error">
            {error}
          </p>
        ) : null}

        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          The old period, its ledger and its reports stay selectable. Paid rows are
          never copied as new expenses. A later pre-cutoff correction posts a
          labeled reconciliation adjustment in derived periods; it never rewrites a
          verified opening.
        </p>
        <div>
          <PendingSubmitButton pendingLabel="Rolling over…">
            Roll over to {preview.targets.startDate}
          </PendingSubmitButton>
        </div>
      </form>
    </section>
  );
}
