"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  EXPENSE_CATEGORY_LABELS,
  MONEY_BUDGET_PERIOD_LABEL,
} from "@ega/domain/money";
import {
  EXPENSE_CATEGORY_VALUES,
  type ExpenseCategory,
} from "@ega/domain/expenses";
import type { MoneyBudgetPlanDto } from "@ega/contracts/money";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { formatMinorToMadInput, parseMadAmountToMinor } from "@/lib/money/money-amount";

import type { SaveBudgetPlanActionInput } from "../actions";

type BudgetPlanFormProps = {
  plan: MoneyBudgetPlanDto | null;
  periodStartDate: string;
  periodEndDate: string;
  /** Ended/rolled-over periods keep their plan readable but not editable. */
  readOnly?: boolean;
  action: (input: SaveBudgetPlanActionInput) => Promise<
    { ok: true; plan: MoneyBudgetPlanDto } | { ok: false; code: string; error: string }
  >;
};

function emptyAllocationValues(): Record<ExpenseCategory, string> {
  return Object.fromEntries(
    EXPENSE_CATEGORY_VALUES.map((category) => [category, ""]),
  ) as Record<ExpenseCategory, string>;
}

function allocationValues(
  allocations: MoneyBudgetPlanDto["allocations"] | undefined,
): Record<ExpenseCategory, string> {
  return Object.fromEntries(
    EXPENSE_CATEGORY_VALUES.map((category) => [
      category,
      allocations?.[category] == null
        ? ""
        : formatMinorToMadInput(allocations[category] as number),
    ]),
  ) as Record<ExpenseCategory, string>;
}

function parseOptionalAmount(
  raw: string,
  allowZero: boolean,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed === "0" && allowZero) return { ok: true, value: 0 };
  const parsed = parseMadAmountToMinor(trimmed);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, value: parsed.value };
}

/**
 * Editable period budget plan (MONEY-05). Allocations, savings/emergency
 * targets and coffee weekly limits are one versioned plan. Routine spending
 * never calls this form and never rewrites these values.
 */
export function BudgetPlanForm({
  plan,
  periodStartDate,
  periodEndDate,
  readOnly = false,
  action,
}: BudgetPlanFormProps) {
  const router = useRouter();
  const [allocations, setAllocations] = useState(() =>
    plan ? allocationValues(plan.allocations) : emptyAllocationValues(),
  );
  const [savingsTarget, setSavingsTarget] = useState(
    plan?.savingsTargetMinor == null
      ? ""
      : formatMinorToMadInput(plan.savingsTargetMinor),
  );
  const [emergencyTarget, setEmergencyTarget] = useState(
    plan?.emergencyTargetMinor == null
      ? ""
      : formatMinorToMadInput(plan.emergencyTargetMinor),
  );
  const [coffeeSpendLimit, setCoffeeSpendLimit] = useState(
    plan?.coffeeWeeklySpendLimitMinor == null
      ? ""
      : formatMinorToMadInput(plan.coffeeWeeklySpendLimitMinor),
  );
  const [coffeeVisitLimit, setCoffeeVisitLimit] = useState(
    plan?.coffeeWeeklyVisitLimit == null ? "" : String(plan.coffeeWeeklyVisitLimit),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const version = plan?.version ?? 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    setSaved(false);
    const parsedAllocations: Partial<Record<ExpenseCategory, number>> = {};
    for (const category of EXPENSE_CATEGORY_VALUES) {
      const parsed = parseOptionalAmount(allocations[category], true);
      if (!parsed.ok) {
        setError(`${EXPENSE_CATEGORY_LABELS[category]}: ${parsed.error}`);
        return;
      }
      if (parsed.value !== null) parsedAllocations[category] = parsed.value;
    }
    const savings = parseOptionalAmount(savingsTarget, true);
    if (!savings.ok) {
      setError(`Savings target: ${savings.error}`);
      return;
    }
    const emergency = parseOptionalAmount(emergencyTarget, true);
    if (!emergency.ok) {
      setError(`Emergency target: ${emergency.error}`);
      return;
    }
    const coffeeSpend = parseOptionalAmount(coffeeSpendLimit, true);
    if (!coffeeSpend.ok) {
      setError(`Coffee weekly spend limit: ${coffeeSpend.error}`);
      return;
    }
    let visitLimit: number | null = null;
    if (coffeeVisitLimit.trim() !== "") {
      if (!/^\d+$/.test(coffeeVisitLimit.trim())) {
        setError("Coffee weekly visit limit must be a whole number.");
        return;
      }
      visitLimit = Number(coffeeVisitLimit.trim());
    }
    setError(null);
    const result = await action({
      periodStartDate,
      periodEndDate,
      version,
      allocations: parsedAllocations,
      savingsTargetMinor: savings.value,
      emergencyTargetMinor: emergency.value,
      coffeeWeeklySpendLimitMinor: coffeeSpend.value,
      coffeeWeeklyVisitLimit: visitLimit,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        {MONEY_BUDGET_PERIOD_LABEL} for {periodStartDate} to {periodEndDate}.
        Empty means not set; 0 is a deliberate zero. Only you change these
        values — recording an expense never does.
      </p>
      <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <legend className="sr-only">Category allocations in MAD</legend>
        {EXPENSE_CATEGORY_VALUES.map((category) => (
          <div key={category} className="flex flex-col gap-1.5">
            <label htmlFor={`allocation-${category}`} className="form-label">
              {EXPENSE_CATEGORY_LABELS[category]}
            </label>
            <Input
              id={`allocation-${category}`}
              name={`allocation:${category}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Not set"
              value={allocations[category]}
              disabled={readOnly}
              onChange={(event) =>
                setAllocations((current) => ({
                  ...current,
                  [category]: event.target.value,
                }))
              }
            />
          </div>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="savings-target" className="form-label">
            Savings target
          </label>
          <Input
            id="savings-target"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Not set"
            value={savingsTarget}
            disabled={readOnly}
            onChange={(event) => setSavingsTarget(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="emergency-target" className="form-label">
            Emergency target
          </label>
          <Input
            id="emergency-target"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Not set"
            value={emergencyTarget}
            disabled={readOnly}
            onChange={(event) => setEmergencyTarget(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="coffee-spend-limit" className="form-label">
            Coffee spend / week
          </label>
          <Input
            id="coffee-spend-limit"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Not set"
            value={coffeeSpendLimit}
            disabled={readOnly}
            onChange={(event) => setCoffeeSpendLimit(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="coffee-visit-limit" className="form-label">
            Coffee visits / week
          </label>
          <Input
            id="coffee-visit-limit"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Not set"
            value={coffeeVisitLimit}
            disabled={readOnly}
            onChange={(event) => setCoffeeVisitLimit(event.target.value)}
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-[length:var(--text-meta)]">
          Period plan saved.
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        {readOnly ? (
          <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            This period is not tracking, so its plan is read-only. Select or create
            the tracking period to edit it.
          </span>
        ) : (
          <>
            <PendingSubmitButton pendingLabel="Saving…">
              {plan ? "Save period plan" : "Create period plan"}
            </PendingSubmitButton>
            <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Version {version}
            </span>
          </>
        )}
      </div>
    </form>
  );
}
