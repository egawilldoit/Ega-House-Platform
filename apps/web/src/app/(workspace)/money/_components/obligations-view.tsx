import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import {
  createAuthenticatedActor,
  getObligationSummary,
  listObligations,
  listObligationTemplates,
} from "@ega/application";
import { SupabaseObligationRepository } from "@ega/data-access";
import { EXPENSE_CATEGORY_VALUES } from "@ega/domain/expenses";
import { getLocalDateInTimezone } from "@ega/domain/time-context";
import {
  OBLIGATION_CADENCES,
  type ObligationKind,
  type ObligationOccurrence,
} from "@ega/domain/obligations";
import { MONEY_PURPOSES } from "@ega/domain/money";

import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { formatMinorToMad, formatMinorToMadInput } from "@/lib/money/money-amount";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";

import {
  createObligationFormAction,
  createTemplateFormAction,
  generateObligationsFormAction,
  transitionObligationFormAction,
  updateObligationFormAction,
  updateTemplateFormAction,
} from "../obligations-actions";
import {
  correctObligationPaymentFormAction,
  payObligationFormAction,
  undoObligationPaymentFormAction,
} from "../obligation-payment-actions";
import { PendingPaymentButton } from "./pending-payment-button";

export type ObligationsSearchParams = {
  notice?: string;
  error?: string;
  offset?: string;
};

const COPY: Record<
  ObligationKind,
  { title: string; description: string; none: string }
> = {
  bill: {
    title: "Bills",
    description:
      "Bills are obligation occurrences, not cash movements. Only a recorded payment moves cash.",
    none: "No bills recorded yet.",
  },
  subscription: {
    title: "Subscriptions",
    description:
      "Subscriptions are the same obligation occurrences as bills, filtered by kind. One payment state, never two.",
    none: "No subscriptions recorded yet.",
  },
};

const NEED_VS_WANT_OPTIONS = ["need", "want"] as const;

const PAYMENT_METHOD_OPTIONS = [
  "cash",
  "card",
  "bank_transfer",
  "mobile_wallet",
  "other",
] as const;

function occurrencePath(kind: ObligationKind): string {
  return kind === "bill" ? "/money/bills" : "/money/subscriptions";
}

function isoDateOffset(offset: string | undefined): number {
  const parsed = /^\d+$/.test(offset ?? "") ? Number(offset) : 0;
  return Number.isSafeInteger(parsed) ? Math.min(parsed, 100_000) : 0;
}

/**
 * Shared bills/subscriptions projection (MONEY-06).
 *
 * Both routes read the same occurrence rows through the same use cases; only
 * the `kind` filter differs. There is no second paid flag and no separate
 * bill/subscription store. Lifecycle forms are versioned and state the
 * effective date; none of them posts cash.
 */
export async function ObligationsView({
  kind,
  searchParams,
}: {
  kind: ObligationKind;
  searchParams: ObligationsSearchParams;
}) {
  const user = await getCurrentUser();
  const path = occurrencePath(kind);
  if (!user) redirect(`/login?next=${path}`);

  const client = await createClient();
  const time = await getWebTimeContext().catch(() => ({ timezone: "UTC" }));
  const timezone = time.timezone;
  const localToday = getLocalDateInTimezone(new Date(), timezone);
  const actor = createAuthenticatedActor(user.id);
  const repository = new SupabaseObligationRepository(client);
  const offset = isoDateOffset(searchParams.offset);
  const copy = COPY[kind];

  const [listResult, summaryResult, templateResult] = await Promise.all([
    listObligations(actor, repository, {
      kind,
      limit: "25",
      offset: String(offset),
    }).catch(() => null),
    getObligationSummary(actor, repository, {
      cutoff: localToday,
      kind,
    }).catch(() => null),
    listObligationTemplates(actor, repository, { kind }).catch(() => null),
  ]);

  const occurrences = listResult?.ok ? listResult.data.occurrences : null;
  const summary = summaryResult?.ok ? summaryResult.data : null;
  const templates = templateResult?.ok ? templateResult.data.templates : null;
  const activeTemplates =
    templates?.filter((template) => template.lifecycle === "active") ?? [];
  const returnTo = path;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <WorkspacePageHeader title={copy.title} description={copy.description} />

      <nav aria-label="Money sections" className="mt-4 flex flex-wrap gap-4 text-[length:var(--text-body)]">
        <a className="underline" href="/money">
          Money ledger
        </a>
        <a className="underline" aria-current={kind === "bill" ? "page" : undefined} href="/money/bills">
          Bills
        </a>
        <a
          className="underline"
          aria-current={kind === "subscription" ? "page" : undefined}
          href="/money/subscriptions"
        >
          Subscriptions
        </a>
      </nav>

      {searchParams.notice ? (
        <p role="status" className="mt-4 rounded-lg border border-ega-border p-4">
          {searchParams.notice}
        </p>
      ) : null}
      {searchParams.error ? (
        <p role="alert" className="mt-4 rounded-lg border border-ega-border p-4">
          {searchParams.error}
        </p>
      ) : null}

      <section aria-labelledby="obligation-summary-heading" className="mt-6 rounded-lg border border-ega-border p-5">
        <h2 id="obligation-summary-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
          Outstanding at {localToday}
        </h2>
        {summary ? (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Due today</dt>
                <dd className="text-[length:var(--text-body)] font-medium">{formatMinorToMad(summary.dueMinor)}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Overdue</dt>
                <dd className="text-[length:var(--text-body)] font-medium">{formatMinorToMad(summary.overdueMinor)}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Outstanding reserve</dt>
                <dd className="text-[length:var(--text-body)] font-medium">{formatMinorToMad(summary.outstandingMinor)}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">Paid to date</dt>
                <dd className="text-[length:var(--text-body)] font-medium">{formatMinorToMad(summary.paidMinor)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              {summary.occurrenceCount} complete occurrence(s) due on or before {summary.cutoffDate}; waived and
              cancelled occurrences hold zero reserve. {summary.truncated ? "Totals are a lower bound (occurrence cap reached)." : "Totals are complete for this cutoff."}
            </p>
          </>
        ) : (
          <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Outstanding totals are unavailable right now. This is not a zero total.
          </p>
        )}
      </section>

      <section aria-labelledby="obligation-list-heading" className="mt-6">
        <h2 id="obligation-list-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
          Recorded {kind === "bill" ? "bills" : "subscriptions"}
        </h2>
        {occurrences === null ? (
          <div role="alert" className="mt-3 rounded-lg border border-ega-border p-4">
            <p>Obligations could not be loaded.</p>
            <a className="underline" href={`${path}?offset=${offset}`}>
              Retry
            </a>
          </div>
        ) : occurrences.length === 0 ? (
          <p className="mt-3 rounded-lg border border-ega-border p-4 text-[color:var(--ega-text-secondary)]">
            {copy.none}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {occurrences.map((occurrence) => (
              <li key={occurrence.id}>
                <OccurrenceCard
                  occurrence={occurrence}
                  localToday={localToday}
                  returnTo={returnTo}
                />
              </li>
            ))}
          </ul>
        )}
        {occurrences !== null ? (
          <nav aria-label="Obligation pages" className="mt-4 flex justify-between">
            <span>
              {offset > 0 ? (
                <a className="underline" href={`${path}?offset=${Math.max(0, offset - 25)}`}>
                  Previous
                </a>
              ) : null}
            </span>
            <span>
              {listResult?.ok && listResult.data.pagination.hasMore ? (
                <a className="underline" href={`${path}?offset=${offset + 25}`}>
                  Next
                </a>
              ) : null}
            </span>
          </nav>
        ) : null}
      </section>

      <section aria-labelledby="obligation-create-heading" className="mt-6 rounded-lg border border-ega-border p-5">
        <h2 id="obligation-create-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
          Add {kind === "bill" ? "a bill" : "a subscription"}
        </h2>
        <form action={createObligationFormAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="stateEffectiveDate" value={localToday} />
          <input type="hidden" name="idempotencyKey" value={`web-obligation:${user.id}:${randomUUID()}`} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Description
              <input className="rounded border border-ega-border p-2" name="description" required maxLength={200} />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Amount (MAD)
              <input className="rounded border border-ega-border p-2" name="amount" required inputMode="decimal" placeholder="350.00" />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Due date
              <input className="rounded border border-ega-border p-2" type="date" name="dueDate" required defaultValue={localToday} />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Recurring template (optional)
              <select className="rounded border border-ega-border p-2" name="templateId" defaultValue="">
                <option value="">One-off occurrence</option>
                {activeTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.description} · {template.cadence}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Period start (optional)
              <input className="rounded border border-ega-border p-2" type="date" name="periodStart" />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Period end (optional)
              <input className="rounded border border-ega-border p-2" type="date" name="periodEnd" />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Need or want (unknown until payment)
              <select className="rounded border border-ega-border p-2" name="needVsWant" defaultValue="">
                <option value="">Unknown for now</option>
                {NEED_VS_WANT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Purpose
              <select className="rounded border border-ega-border p-2" name="purpose" defaultValue="">
                <option value="">Use the template or kind default</option>
                {MONEY_PURPOSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Counts in daily spending
              <select className="rounded border border-ega-border p-2" name="countsInDaily" defaultValue="">
                <option value="">Use the template or kind default</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Category
              <select className="rounded border border-ega-border p-2" name="category" defaultValue="">
                <option value="">Use the template or kind default</option>
                {EXPENSE_CATEGORY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="self-start rounded border border-ega-border px-4 py-2" type="submit">
            Record pending occurrence
          </button>
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Recording a scheduled obligation does not move cash. Need or want stays unknown until payment states it.
          </p>
        </form>
      </section>

      <section aria-labelledby="template-heading" className="mt-6 rounded-lg border border-ega-border p-5">
        <h2 id="template-heading" className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]">
          Recurring templates
        </h2>
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Templates supply recurrence and classification defaults. Editing a template never rewrites occurrences
          already generated from it, and a template never posts cash.
        </p>
        {templates === null ? (
          <p role="alert" className="mt-3 text-[length:var(--text-meta)]">
            Templates are unavailable right now.
          </p>
        ) : templates.length === 0 ? (
          <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            No templates yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {templates.map((template) => (
              <li key={template.id} className="rounded border border-ega-border p-3">
                <p className="font-medium">
                  {template.description} · {formatMinorToMad(template.amountMinor)} · {template.cadence}
                </p>
                <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                  {template.lifecycle} · starts {template.startDate}
                  {template.endDate ? ` · ends ${template.endDate}` : ""} · purpose {template.purpose ?? "kind default"} ·
                  counts in daily {template.countsInDaily === null ? "kind default" : String(template.countsInDaily)}
                </p>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <form action={generateObligationsFormAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="templateId" value={template.id} />
                    <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
                      Generate through
                      <input className="rounded border border-ega-border p-2" type="date" name="throughDate" defaultValue={localToday} />
                    </label>
                    <button className="rounded border border-ega-border px-3 py-1" type="submit" disabled={template.lifecycle !== "active"}>
                      Generate occurrences
                    </button>
                  </form>
                  <form action={updateTemplateFormAction}>
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="templateId" value={template.id} />
                    <input type="hidden" name="version" value={template.version} />
                    <input
                      type="hidden"
                      name="templateAction"
                      value={template.lifecycle === "active" ? "archive" : "activate"}
                    />
                    <button className="rounded border border-ega-border px-3 py-1" type="submit">
                      {template.lifecycle === "active" ? "Archive template" : "Reactivate template"}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form action={createTemplateFormAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="idempotencyKey" value={`web-template:${user.id}:${randomUUID()}`} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Description
              <input className="rounded border border-ega-border p-2" name="description" required maxLength={200} />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Amount (MAD)
              <input className="rounded border border-ega-border p-2" name="amount" required inputMode="decimal" placeholder="49.00" />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Recurrence
              <select className="rounded border border-ega-border p-2" name="cadence" defaultValue="monthly">
                {OBLIGATION_CADENCES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Due day of month (weekly uses the weekday field)
              <input className="rounded border border-ega-border p-2" name="dueDayOfMonth" inputMode="numeric" placeholder="15" />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Due weekday for weekly templates
              <select className="rounded border border-ega-border p-2" name="dueWeekday" defaultValue="">
                <option value="">Not weekly</option>
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Starts
              <input className="rounded border border-ega-border p-2" type="date" name="startDate" required defaultValue={localToday} />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Ends (optional)
              <input className="rounded border border-ega-border p-2" type="date" name="endDate" />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Need or want default
              <select className="rounded border border-ega-border p-2" name="needVsWant" defaultValue="">
                <option value="">No default (unknown until payment)</option>
                {NEED_VS_WANT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Purpose default
              <select className="rounded border border-ega-border p-2" name="purpose" defaultValue="">
                <option value="">Kind default</option>
                {MONEY_PURPOSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Daily-spending default
              <select className="rounded border border-ega-border p-2" name="countsInDaily" defaultValue="">
                <option value="">Kind default</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Category default
              <select className="rounded border border-ega-border p-2" name="category" defaultValue="">
                <option value="">Kind default</option>
                {EXPENSE_CATEGORY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="self-start rounded border border-ega-border px-4 py-2" type="submit">
            Save template
          </button>
        </form>
      </section>
    </main>
  );
}

function StateBadge({ state }: { state: ObligationOccurrence["state"] }) {
  return (
    <span className="rounded border border-ega-border px-2 py-0.5 text-[length:var(--text-meta)]">
      {state}
    </span>
  );
}

function TransitionForm({
  occurrence,
  returnTo,
  to,
  label,
  localToday,
}: {
  occurrence: ObligationOccurrence;
  returnTo: string;
  to: "waived" | "cancelled" | "pending";
  label: string;
  localToday: string;
}) {
  return (
    <form action={transitionObligationFormAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="obligationId" value={occurrence.id} />
      <input type="hidden" name="version" value={occurrence.version} />
      <input type="hidden" name="to" value={to} />
      <input type="hidden" name="effectiveDate" value={localToday} />
      {to === "pending" ? null : (
        <label className="flex flex-col gap-1 text-[length:var(--text-meta)]">
          Reason
          <input className="rounded border border-ega-border p-2" name="reason" maxLength={200} />
        </label>
      )}
      <button className="rounded border border-ega-border px-3 py-1" type="submit">
        {label}
      </button>
    </form>
  );
}

/**
 * MONEY-07 payment form for a pending occurrence. The payment date, the
 * need/want choice and the optional overrides are the only inputs: the amount
 * is the occurrence's own amount, because one occurrence is settled by one
 * full payment.
 */
function PayForm({
  occurrence,
  returnTo,
  localToday,
}: {
  occurrence: ObligationOccurrence;
  returnTo: string;
  localToday: string;
}) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[length:var(--text-body)]">
        Pay this obligation
      </summary>
      <form action={payObligationFormAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="obligationId" value={occurrence.id} />
        <input type="hidden" name="version" value={occurrence.version} />
        <input type="hidden" name="operationId" value={randomUUID()} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
            Payment date
            <input
              className="rounded border border-ega-border p-2"
              type="date"
              name="bookingDate"
              defaultValue={localToday}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
            Need or want
            <select
              className="rounded border border-ega-border p-2"
              name="needVsWant"
              defaultValue={occurrence.needVsWant ?? ""}
              required
            >
              <option value="">Choose need or want</option>
              {NEED_VS_WANT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
            Counts in daily spending
            <select
              className="rounded border border-ega-border p-2"
              name="countsInDaily"
              defaultValue=""
            >
              <option value="">Use the obligation default</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
            Payment method
            <select
              className="rounded border border-ega-border p-2"
              name="paymentMethod"
              defaultValue=""
            >
              <option value="">Not recorded</option>
              {PAYMENT_METHOD_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <PendingPaymentButton pendingLabel="Recording payment...">
          Pay {formatMinorToMad(occurrence.amountMinor)}
        </PendingPaymentButton>
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Paying records one ledger outflow and settles the obligation in the same transaction. A fixed
          obligation normally stays out of daily spending.
        </p>
      </form>
    </details>
  );
}

/**
 * MONEY-07 correction and undo for a paid occurrence. Both move the linked
 * payment and the occurrence together; a generic expense edit cannot.
 */
function PaidPaymentActions({
  occurrence,
  returnTo,
}: {
  occurrence: ObligationOccurrence;
  returnTo: string;
}) {
  return (
    <>
      <details className="mt-2">
        <summary className="cursor-pointer text-[length:var(--text-body)]">
          Correct the linked payment
        </summary>
        <form
          action={correctObligationPaymentFormAction}
          className="mt-3 flex flex-col gap-3"
        >
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="obligationId" value={occurrence.id} />
          <input type="hidden" name="version" value={occurrence.version} />
          <input type="hidden" name="operationId" value={randomUUID()} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Paid amount (MAD)
              <input
                className="rounded border border-ega-border p-2"
                name="amount"
                defaultValue={formatMinorToMadInput(occurrence.amountMinor)}
                required
                inputMode="decimal"
              />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Payment date
              <input
                className="rounded border border-ega-border p-2"
                type="date"
                name="bookingDate"
                defaultValue={occurrence.stateEffectiveDate}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Counts in daily spending
              <select
                className="rounded border border-ega-border p-2"
                name="countsInDaily"
                defaultValue={String(occurrence.countsInDaily)}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          </div>
          <PendingPaymentButton pendingLabel="Correcting payment...">
            Save correction
          </PendingPaymentButton>
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            The corrected amount, date and daily flag are applied to the linked ledger payment and the
            obligation in one transaction.
          </p>
        </form>
      </details>
      <form action={undoObligationPaymentFormAction} className="mt-2">
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="obligationId" value={occurrence.id} />
        <input type="hidden" name="version" value={occurrence.version} />
        <input type="hidden" name="operationId" value={randomUUID()} />
        <PendingPaymentButton pendingLabel="Undoing payment...">
          Undo this payment
        </PendingPaymentButton>
        <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Undoing removes the ledger outflow and reopens the obligation, so cash and the outstanding reserve
          are restored together.
        </p>
      </form>
    </>
  );
}

function OccurrenceCard({
  occurrence,
  localToday,
  returnTo,
}: {
  occurrence: ObligationOccurrence;
  localToday: string;
  returnTo: string;
}) {
  const isPaid = occurrence.state === "paid";
  const canReopen =
    occurrence.state === "waived" || occurrence.state === "cancelled";
  return (
    <article className="rounded-lg border border-ega-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {occurrence.description} · {formatMinorToMad(occurrence.amountMinor)}
        </p>
        <StateBadge state={occurrence.state} />
      </div>
      <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        {occurrence.kind} · due {occurrence.dueDate} · period {occurrence.periodStart}–{occurrence.periodEnd} ·
        version {occurrence.version}
        {occurrence.templateId ? " · from template" : ""}
      </p>
      <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        need/want {occurrence.needVsWant ?? "unknown until payment"} · purpose {occurrence.purpose} · counts in
        daily {String(occurrence.countsInDaily)} · category {occurrence.category ?? "unclassified"} · state since{" "}
        {occurrence.stateEffectiveDate}
        {occurrence.stateReason ? ` · ${occurrence.stateReason}` : ""}
      </p>
      {isPaid ? (
        <div className="mt-2">
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {occurrence.paymentExpenseId
              ? "Paid by a linked canonical ledger payment. Correct or undo it here; a generic expense edit cannot change it."
              : occurrence.paymentEvidence
                ? `Paid according to reconciled historical import evidence (${occurrence.paymentEvidence.reference}); payment history is not claimed.`
                : "Paid. Linked payment details are unavailable."}
          </p>
          <PaidPaymentActions occurrence={occurrence} returnTo={returnTo} />
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <TransitionForm occurrence={occurrence} returnTo={returnTo} to="waived" label="Waive" localToday={localToday} />
          <TransitionForm occurrence={occurrence} returnTo={returnTo} to="cancelled" label="Cancel" localToday={localToday} />
        </div>
      )}
      {canReopen ? (
        <div className="mt-2">
          <TransitionForm occurrence={occurrence} returnTo={returnTo} to="pending" label="Reopen to pending" localToday={localToday} />
        </div>
      ) : null}
      {occurrence.state === "pending" ? (
        <PayForm occurrence={occurrence} returnTo={returnTo} localToday={localToday} />
      ) : null}

      <details className="mt-3">
        <summary className="cursor-pointer text-[length:var(--text-body)]">Edit occurrence</summary>
        <form action={updateObligationFormAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="obligationId" value={occurrence.id} />
          <input type="hidden" name="version" value={occurrence.version} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Description
              <input className="rounded border border-ega-border p-2" name="description" defaultValue={occurrence.description} required maxLength={200} />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Amount (MAD)
              <input className="rounded border border-ega-border p-2" name="amount" defaultValue={formatMinorToMadInput(occurrence.amountMinor)} required inputMode="decimal" />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Due date
              <input className="rounded border border-ega-border p-2" type="date" name="dueDate" defaultValue={occurrence.dueDate} required />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Period start
              <input className="rounded border border-ega-border p-2" type="date" name="periodStart" defaultValue={occurrence.periodStart} required />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Period end
              <input className="rounded border border-ega-border p-2" type="date" name="periodEnd" defaultValue={occurrence.periodEnd} required />
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Need or want
              <select className="rounded border border-ega-border p-2" name="needVsWant" defaultValue={occurrence.needVsWant ?? ""}>
                <option value="">Unknown</option>
                {NEED_VS_WANT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Purpose
              <select className="rounded border border-ega-border p-2" name="purpose" defaultValue={occurrence.purpose}>
                {MONEY_PURPOSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Counts in daily spending
              <select className="rounded border border-ega-border p-2" name="countsInDaily" defaultValue={String(occurrence.countsInDaily)}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--text-body)]">
              Category
              <select className="rounded border border-ega-border p-2" name="category" defaultValue={occurrence.category ?? ""}>
                <option value="">Unclassified</option>
                {EXPENSE_CATEGORY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="self-start rounded border border-ega-border px-4 py-2" type="submit">
            Save edit
          </button>
          {isPaid ? (
            <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Paid occurrences are settled by their linked payment; only the description can change here.
            </p>
          ) : null}
        </form>
      </details>
    </article>
  );
}
