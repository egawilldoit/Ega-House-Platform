"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type {
  MoneyCashDto,
  MoneyOpeningDto,
  MoneyStatePeriodSummaryDto,
} from "@ega/contracts/money";
import type { MoneyPeriodDto } from "@ega/contracts/money";
import { formatMinorToMad } from "@/lib/money/money-amount";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

type MoneyFormActionResult =
  | { ok: true; error: null }
  | { ok: false; error: string };

type MoneyPeriodPanelProps = {
  localToday: string;
  timezone: string;
  period: MoneyPeriodDto | null;
  opening: MoneyOpeningDto;
  cash: MoneyCashDto;
  history: readonly MoneyStatePeriodSummaryDto[];
  legacyReviewRequired: boolean;
  selectedPeriodId: string | null;
  createAction: (formData: FormData) => Promise<MoneyFormActionResult>;
  updateAction: (formData: FormData) => Promise<MoneyFormActionResult>;
};

function defaultMonthRange(localToday: string): { start: string; end: string } {
  const [yearText, monthText] = localToday.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return { start: localToday, end: localToday };
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    start: `${yearText}-${monthText}-01`,
    end: `${yearText}-${monthText}-${pad(lastDay)}`,
  };
}

/**
 * Money period setup and settings. Both forms call the same application use
 * cases as MCP; identity stays on the server session and the version is posted
 * explicitly so a stale settings form cannot overwrite a newer period.
 */
export function MoneyPeriodPanel({
  localToday,
  timezone,
  period,
  opening,
  cash,
  history,
  legacyReviewRequired,
  selectedPeriodId,
  createAction,
  updateAction,
}: MoneyPeriodPanelProps) {
  const router = useRouter();
  const initialRange = defaultMonthRange(localToday);
  const [createStart, setCreateStart] = useState(initialRange.start);
  const [createEnd, setCreateEnd] = useState(initialRange.end);
  const [createActive, setCreateActive] = useState(localToday);
  const [createOpened, setCreateOpened] = useState("unknown");
  const [createAmount, setCreateAmount] = useState("");
  const [createCutoff, setCreateCutoff] = useState("");
  const [createEvidence, setCreateEvidence] = useState("");
  const [createNote, setCreateNote] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [activeDate, setActiveDate] = useState(period?.activeDate ?? localToday);
  const [openingMode, setOpeningMode] = useState("unchanged");
  const [openingAmount, setOpeningAmount] = useState(
    opening.status === "known" ? (opening.amountMinor / 100).toFixed(2) : "",
  );
  const [openingCutoff, setOpeningCutoff] = useState("");
  const [openingEvidence, setOpeningEvidence] = useState("");
  const [openingNote, setOpeningNote] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    const formData = new FormData();
    formData.set("startDate", createStart);
    formData.set("endDate", createEnd);
    formData.set("activeDate", createActive);
    formData.set("timezone", timezone);
    formData.set("openingMode", createOpened);
    if (createOpened === "known" || createOpened === "verified") {
      formData.set("openingAmount", createAmount);
      formData.set("openingCutoffDate", createCutoff);
      formData.set("openingEvidence", createEvidence);
      formData.set("openingNote", createNote);
    }
    const result = await createAction(formData);
    if (!result.ok) {
      setCreateError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!period) return;
    setSettingsError(null);
    const formData = new FormData();
    formData.set("periodId", period.id);
    formData.set("version", String(period.version));
    formData.set("activeDate", activeDate);
    formData.set("openingMode", openingMode);
    if (openingMode !== "unchanged") {
      formData.set("openingAmount", openingAmount);
      formData.set("openingCutoffDate", openingCutoff);
      formData.set("openingEvidence", openingEvidence);
      formData.set("openingNote", openingNote);
    }
    const result = await updateAction(formData);
    if (!result.ok) {
      setSettingsError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <section
      aria-labelledby="money-period-heading"
      className="mt-6 rounded-lg border border-ega-border p-5"
    >
      <h2
        id="money-period-heading"
        className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]"
      >
        Tracking period
      </h2>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Local today
          </dt>
          <dd className="text-[length:var(--text-body)] font-medium tabular-nums">
            {localToday}
          </dd>
        </div>
        <div>
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Active date
          </dt>
          <dd className="text-[length:var(--text-body)] font-medium tabular-nums">
            {period?.activeDate ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Timezone
          </dt>
          <dd className="text-[length:var(--text-body)] font-medium">{timezone}</dd>
        </div>
        <div>
          <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Opening / cash
          </dt>
          <dd className="text-[length:var(--text-body)] font-medium tabular-nums">
            {opening.status === "known"
              ? formatMinorToMad(opening.amountMinor)
              : "Unknown"}
            <span className="block text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-secondary)]">
              {cash.available
                ? `Recorded ${formatMinorToMad(cash.recordedCashMinor)} through ${cash.cutoffDate}`
                : "Recorded cash unavailable"}
            </span>
          </dd>
        </div>
      </dl>

      {period ? (
        <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          {period.startDate}–{period.endDate} · {period.lifecycle.replaceAll("_", " ")} ·{" "}
          {period.initialization.replaceAll("_", " ")} · version {period.version}
          {selectedPeriodId ? (
            <>
              {" · "}
              <a className="underline" href="/money">
                Back to current period
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          No period yet. Opening cash stays unknown until you initialize it. Existing
          expense rows keep their IDs and dates.
        </p>
      )}

      {period && localToday !== period.activeDate ? (
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Actual today differs from the active tracking date. “Today” still means{" "}
          {localToday}; the active day is {period.activeDate}.
        </p>
      ) : null}

      {period && period.lifecycle !== "tracking" ? (
        <p role="status" className="mt-2 text-[length:var(--text-meta)]">
          This period is {period.lifecycle.replaceAll("_", " ")}. Routine settings are
          closed; use the historical correction path.
        </p>
      ) : null}

      {legacyReviewRequired ? (
        <p role="status" className="mt-2 text-[length:var(--text-meta)]">
          Some legacy expenses fall inside this period but are not assigned to it.
          Their booking dates are derived from the owner timezone and are shown for
          review; they are not claimed reconciled.
        </p>
      ) : null}

      {!period ? (
        <div className="mt-4">
          <h3 className="text-[length:var(--text-body)] font-semibold">
            Set up a period
          </h3>
          <form onSubmit={handleCreate} className="mt-2 flex flex-col gap-3" noValidate>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="period-start" className="form-label">
                  Start
                </label>
                <Input
                  id="period-start"
                  type="date"
                  value={createStart}
                  onChange={(event) => setCreateStart(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="period-end" className="form-label">
                  End
                </label>
                <Input
                  id="period-end"
                  type="date"
                  value={createEnd}
                  onChange={(event) => setCreateEnd(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="period-active" className="form-label">
                  Active date
                </label>
                <Input
                  id="period-active"
                  type="date"
                  value={createActive}
                  onChange={(event) => setCreateActive(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="period-opening-mode" className="form-label">
                  Opening cash
                </label>
                <select
                  id="period-opening-mode"
                  className="input-instrument"
                  value={createOpened}
                  onChange={(event) => setCreateOpened(event.target.value)}
                >
                  <option value="unknown">Unknown</option>
                  <option value="known">Known</option>
                  <option value="verified">Verified source</option>
                </select>
              </div>
            </div>
            {createOpened !== "unknown" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="period-opening-amount" className="form-label">
                    Opening (MAD)
                  </label>
                  <Input
                    id="period-opening-amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={createAmount}
                    onChange={(event) => setCreateAmount(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="period-opening-cutoff" className="form-label">
                    Cutoff date
                  </label>
                  <Input
                    id="period-opening-cutoff"
                    type="date"
                    value={createCutoff}
                    onChange={(event) => setCreateCutoff(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="period-opening-evidence" className="form-label">
                    Evidence / note
                  </label>
                  <Input
                    id="period-opening-evidence"
                    placeholder="Statement or counted-cash reference"
                    value={createEvidence}
                    onChange={(event) => setCreateEvidence(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
            {createOpened === "known" ? (
              <Input
                aria-label="Opening note"
                placeholder="Optional opening note"
                value={createNote}
                onChange={(event) => setCreateNote(event.target.value)}
              />
            ) : null}
            {createError ? (
              <p role="alert" className="feedback-block feedback-block-error">
                {createError}
              </p>
            ) : null}
            <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Partial periods are valid. A verified opening needs both a cutoff date
              and evidence before it is labeled reconciled. Known zero is different
              from unknown cash.
            </p>
            <div>
              <PendingSubmitButton pendingLabel="Saving…">Save period</PendingSubmitButton>
            </div>
          </form>
        </div>
      ) : null}

      {period && period.lifecycle === "tracking" ? (
        <div className="mt-6">
          <h3 className="text-[length:var(--text-body)] font-semibold">
            Period settings
          </h3>
          <form onSubmit={handleSettings} className="mt-2 flex flex-col gap-3" noValidate>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="settings-active" className="form-label">
                  Active date
                </label>
                <Input
                  id="settings-active"
                  type="date"
                  value={activeDate}
                  onChange={(event) => setActiveDate(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="settings-opening-mode" className="form-label">
                  Opening
                </label>
                <select
                  id="settings-opening-mode"
                  className="input-instrument"
                  value={openingMode}
                  onChange={(event) => setOpeningMode(event.target.value)}
                >
                  <option value="unchanged">Keep current</option>
                  <option value="known">Enter / correct known</option>
                  <option value="verified">Verified source</option>
                </select>
              </div>
              {openingMode !== "unchanged" ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="settings-opening-amount" className="form-label">
                    Opening (MAD)
                  </label>
                  <Input
                    id="settings-opening-amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={openingAmount}
                    onChange={(event) => setOpeningAmount(event.target.value)}
                  />
                </div>
              ) : null}
              {openingMode !== "unchanged" ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="settings-opening-cutoff" className="form-label">
                    Cutoff date
                  </label>
                  <Input
                    id="settings-opening-cutoff"
                    type="date"
                    value={openingCutoff}
                    onChange={(event) => setOpeningCutoff(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
            {openingMode === "verified" ? (
              <Input
                aria-label="Verified evidence"
                placeholder="Required statement/evidence reference"
                value={openingEvidence}
                onChange={(event) => setOpeningEvidence(event.target.value)}
              />
            ) : null}
            {openingMode !== "unchanged" ? (
              <Input
                aria-label="Opening note"
                placeholder="Optional opening note"
                value={openingNote}
                onChange={(event) => setOpeningNote(event.target.value)}
              />
            ) : null}
            {settingsError ? (
              <p role="alert" className="feedback-block feedback-block-error">
                {settingsError}
              </p>
            ) : null}
            <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Changing the active date does not change the period boundaries, close a
              day or reset transactions. A correction keeps one opening ledger row and
              appends reviewable provenance.
            </p>
            <div>
              <PendingSubmitButton pendingLabel="Saving…">
                Save settings
              </PendingSubmitButton>
            </div>
          </form>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-[length:var(--text-body)] font-semibold">Period history</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3">
                <a
                  className="underline"
                  href={`/money?periodId=${encodeURIComponent(entry.id)}`}
                >
                  {entry.startDate}–{entry.endDate}
                </a>
                <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                  {entry.lifecycle.replaceAll("_", " ")} ·{" "}
                  {entry.initialization.replaceAll("_", " ")} · active{" "}
                  {entry.activeDate}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
