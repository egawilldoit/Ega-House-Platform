"use client";

import { useState } from "react";

import { EXPENSE_CATEGORY_VALUES, type ExpenseCategory } from "@ega/domain/expenses";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Input } from "@/components/ui/input";
import { parseMadAmountToMinor } from "@/lib/money/money-amount";

type CategoryCapsFormProps = {
  caps: Partial<Record<ExpenseCategory, number>>;
  action: (formData: FormData) => Promise<{ ok: boolean; error: string | null }>;
  returnTo: string;
};

function humanize(category: ExpenseCategory): string {
  return category.replaceAll("_", " ");
}

function minorToMadInput(minor: number): string {
  return String(minor / 100);
}

/**
 * Optional per-category monthly caps (PO-08, issue #349). Caps live in owner
 * preferences with atomic whole-map saves; they are advisory progress targets
 * and never block expense creation. Trailing empty fields clear that cap.
 */
export function CategoryCapsForm({ caps, action, returnTo }: CategoryCapsFormProps) {
  const [values, setValues] = useState<Record<ExpenseCategory, string>>(() =>
    Object.fromEntries(
      EXPENSE_CATEGORY_VALUES.map((category) => [
        category,
        caps[category] == null ? "" : minorToMadInput(caps[category] as number),
      ]),
    ) as Record<ExpenseCategory, string>,
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    for (const category of EXPENSE_CATEGORY_VALUES) {
      const raw = values[category].trim();
      if (raw === "") continue;
      // Explicit zero is a valid cap (empty means unset); the shared amount
      // parser requires a positive amount for expenses, so the zero check is
      // caps-specific, mirroring the server action.
      if (raw === "0") continue;
      const parsed = parseMadAmountToMinor(raw);
      if (!parsed.ok) {
        setError(`${humanize(category)}: ${parsed.error}`);
        return;
      }
    }
    setError(null);
    const formData = new FormData();
    formData.set("returnTo", returnTo);
    for (const category of EXPENSE_CATEGORY_VALUES) {
      formData.set(`cap:${category}`, values[category]);
    }
    const result = await action(formData);
    setError(result.ok ? null : result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {EXPENSE_CATEGORY_VALUES.map((category) => (
          <div key={category} className="flex flex-col gap-1.5">
            <label htmlFor={`cap-${category}`} className="form-label">
              {humanize(category)}
            </label>
            <Input
              id={`cap-${category}`}
              name={`cap:${category}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="No cap"
              value={values[category]}
              onChange={(event) =>
                setValues((current) => ({ ...current, [category]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>
      {error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {error}
        </p>
      ) : null}
      <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        Monthly caps in MAD. Empty means no cap. Spending over a cap only shows
        an advisory — it never blocks an expense.
      </p>
      <div>
        <PendingSubmitButton pendingLabel="Saving…">Save caps</PendingSubmitButton>
      </div>
    </form>
  );
}
