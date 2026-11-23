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

export function MoneyRolloverPanel(props: MoneyRolloverPanelProps) {
  const preview = props.preview;
  const key = preview
    ? `${preview.source.periodId}:${preview.source.version}:${preview.targets.startDate}:${preview.targets.endDate}`
    : "unavailable";
  return <MoneyRolloverForm key={key} {...props} />;
}

function MoneyRolloverForm({
  preview,
  previewUnavailableReason,
  action,
}: MoneyRolloverPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(preview?.targets.startDate ?? "");
  const [endDate, setEndDate] = useState(preview?.targets.endDate ?? "");
  const [openingMode, setOpeningMode] = useState<"carry_forward" | "verified_source">(
    preview?.openingMode ?? "carry_forward",
  );
  const [allowUncoveredDays, setAllowUncoveredDays] = useState(false);
  const [savingsTarget, setSavingsTarget] = useState("");
  const [emergencyTarget, setEmergencyTarget] = useState("");
  const [unpaidTreatment, setUnpaidTreatment] = useState("keep_pending");
  const [unpaidReason, setUnpaidReason] = useState("");
  const [verifiedAmount, setVerifiedAmount] = useState("");
  const [verifiedCutoff, setVerifiedCutoff] = useState("");
  const [verifiedEvidence, setVerifiedEvidence] = useState("");
  const [differenceNote, setDifferenceNote] = useState("");
  const [unverifiedNote, setUnverifiedNote] = useState("");
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
  const datesChanged = startDate !== preview.targets.startDate || endDate !== preview.targets.endDate;
  const unverifiedUnavailable = preview.closeSnapshots.available === false;
  const unverifiedCount = unverifiedUnavailable
    ? 0
    : (preview.unverifiedDayCount ?? 0);
  const unverifiedDates = unverifiedUnavailable
    ? []
    : (preview.unverifiedDates ?? []);

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
        {preview.source.startDate}–{preview.source.endDate} is under finalization review
        ({preview.source.lifecycle.replaceAll("_", " ")}). Rollover creates one successor and
        keeps the old period selectable. Reviewed unclosed days are acknowledged, never closed
        automatically. Unused daily allowance is not carried forward.
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
          <dd className="font-medium">{datesChanged ? "Recalculated on rollover" : preview.generatedObligations.length}</dd>
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
        <div>
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Unverified days
          </dt>
          <dd className="font-medium" data-testid="rollover-unverified-count">
            {unverifiedUnavailable
              ? "Unavailable — retained close evidence could not be read"
              : unverifiedCount > 0
                ? `${unverifiedCount} reviewed${preview.unverifiedDaysAcknowledged ? " · acknowledged" : " · acknowledgment required"}`
                : "None"}
          </dd>
        </div>
      </dl>

      {preview.closeSnapshots.available &&
      (preview.closeSnapshots.closedDates?.length ?? 0) > 0 ? (
        <details className="mt-3 rounded border border-ega-border p-3">
          <summary className="cursor-pointer text-[length:var(--text-meta)] underline">
            Show the {preview.closeSnapshots.closedDates?.length} previously closed date
            {(preview.closeSnapshots.closedDates?.length ?? 0) === 1 ? "" : "s"}
          </summary>
          <p className="mt-2 break-words text-[length:var(--text-meta)] tabular-nums">
            {preview.closeSnapshots.closedDates?.join(", ")}
          </p>
        </details>
      ) : null}

      {unverifiedCount > 0 ? (
        <div className="mt-3 rounded border border-ega-border p-3">
          <p className="text-[length:var(--text-meta)]">
            Finalization reviews every unclosed date in the inclusive source period. These dates
            stay unverified; no close row is invented for them.
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-[length:var(--text-meta)] underline">
              Show the {unverifiedCount} unverified date{unverifiedCount === 1 ? "" : "s"}
            </summary>
            <p className="mt-1 break-words text-[length:var(--text-meta)] tabular-nums">
              {unverifiedDates.join(", ")}
            </p>
          </details>
        </div>
      ) : null}

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

      {preview.priorCorrectionBridgesTruncated ||
      preview.priorCorrectionBridges.some((bridge) => !bridge.applied) ? (
        <div className="mt-3 rounded border border-ega-border p-3">
          <h3 className="font-medium">Historical correction variances</h3>
          {preview.priorCorrectionBridgesTruncated ? (
            <p role="alert" className="feedback-block feedback-block-error mt-1 text-[length:var(--text-meta)]">
              The bounded variance read returned only part of this period&apos;s
              correction history.
            </p>
          ) : null}
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

      <form action={submit} aria-labelledby="money-rollover-heading" className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="periodId" value={preview.source.periodId} />
        <input type="hidden" name="version" value={preview.source.version} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rollover-start-date" className="form-label">Successor start date (required)</label>
            <Input id="rollover-start-date" name="startDate" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rollover-end-date" className="form-label">Successor end date (required)</label>
            <Input id="rollover-end-date" name="endDate" type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
        </div>
        {datesChanged ? <p role="status" className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">The successor dates changed. Recurring bills will be recalculated for the chosen dates when you roll over.</p> : null}
        <label className="flex items-center gap-2">
          <input type="checkbox" name="allowUncoveredDays" value="true" checked={allowUncoveredDays} onChange={(event) => {
            // React resets the form after resolved actions, including returned errors.
            event.currentTarget.defaultChecked = event.currentTarget.checked;
            setAllowUncoveredDays(event.currentTarget.checked);
          }} />
          Allow untracked days between the finished period and the successor
        </label>
        <fieldset className="flex flex-col gap-3">
          <legend className="form-label">Successor policy</legend>
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">The current policy will be copied. Leave a target blank to keep its current value, or enter a new amount in MAD.</p>
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Current savings target: {typeof preview.settings.savingsTargetMinor === "number" ? formatMinorToMad(preview.settings.savingsTargetMinor) : "Not set"}. Current emergency target: {typeof preview.settings.emergencyTargetMinor === "number" ? formatMinorToMad(preview.settings.emergencyTargetMinor) : "Not set"}.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5"><label htmlFor="rollover-savings-target" className="form-label">New savings target (MAD)</label><Input id="rollover-savings-target" name="savingsTarget" inputMode="decimal" value={savingsTarget} onChange={(event) => setSavingsTarget(event.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="rollover-emergency-target" className="form-label">New emergency target (MAD)</label><Input id="rollover-emergency-target" name="emergencyTarget" inputMode="decimal" value={emergencyTarget} onChange={(event) => setEmergencyTarget(event.target.value)} /></div>
          </div>
        </fieldset>
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
                value={unpaidTreatment}
                onChange={(event) => setUnpaidTreatment(event.target.value)}
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
            <Input id="rollover-unpaid-reason" name="unpaidReason" value={unpaidReason} onChange={(event) => setUnpaidReason(event.target.value)} placeholder="Why this treatment is correct" />
          </div>
        ) : null}

        {openingMode === "verified_source" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rollover-verified-amount" className="form-label">
                Verified balance (MAD)
              </label>
              <Input id="rollover-verified-amount" name="verifiedAmount" inputMode="decimal" value={verifiedAmount} onChange={(event) => setVerifiedAmount(event.target.value)} placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rollover-verified-cutoff" className="form-label">
                Balance date
              </label>
              <Input id="rollover-verified-cutoff" name="verifiedCutoffDate" type="date" value={verifiedCutoff} onChange={(event) => setVerifiedCutoff(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="rollover-verified-evidence" className="form-label">
                Evidence
              </label>
              <Input id="rollover-verified-evidence" name="verifiedEvidence" value={verifiedEvidence} onChange={(event) => setVerifiedEvidence(event.target.value)} placeholder="Statement or counted-cash reference" />
            </div>
          </div>
        ) : null}

        {unverifiedCount > 0 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rollover-unverified-note" className="form-label">
              Acknowledge unverified/unclosed days (retained as provenance)
            </label>
            <Input
              id="rollover-unverified-note"
              name="acceptUnverifiedDaysNote"
              value={unverifiedNote}
              onChange={(event) => setUnverifiedNote(event.target.value)}
              placeholder={`Required to finalize ${unverifiedCount} reviewed unverified day${unverifiedCount === 1 ? "" : "s"}`}
            />
            <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              This note and the exact reviewed count are stored on the rollover receipt. The
              server refuses rollover while the acknowledgment is missing.
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="rollover-difference-note" className="form-label">
            Accept closing, restatement or savings differences (retained as provenance)
          </label>
          <Input id="rollover-difference-note" name="acceptClosingDifferenceNote" value={differenceNote} onChange={(event) => setDifferenceNote(event.target.value)} placeholder="Required when the verified balance differs, a close was restated, savings differ, or a payment/visit mismatch is accepted" />
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Required before confirming a modeled-versus-verified cash difference, a
            restated day close, a savings target versus transfers difference, or an accepted
            paid-obligation/counted-visit mismatch.
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
          <PendingSubmitButton type="submit" pendingLabel="Rolling over…">
            Roll over to {startDate}
          </PendingSubmitButton>
        </div>
      </form>
    </section>
  );
}
