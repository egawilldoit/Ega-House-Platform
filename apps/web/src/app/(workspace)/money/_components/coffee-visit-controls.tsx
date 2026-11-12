"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

/**
 * Counted-visit and explicit-classification controls for one coffee expense.
 * Counting a visit adds only metadata linked to the canonical expense; it never
 * creates another cash effect. "Classify as groceries" leaves counted coffee
 * usage unchanged and increases groceries spending.
 */
export function CoffeeVisitControls({
  expenseId,
  version,
  recordVisit,
  classifyAsGroceries,
}: {
  expenseId: string;
  version: number;
  recordVisit: (expenseId: string) => Promise<
    { ok: true; replayed: boolean } | { ok: false; code: string; error: string }
  >;
  classifyAsGroceries: (
    expenseId: string,
    version: number,
    category: "groceries",
  ) => Promise<
    { ok: true; countedCoffeeUsageChanged: boolean } | { ok: false; code: string; error: string }
  >;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(
    operation: () => Promise<
      { ok: true } | { ok: false; error: string }
    >,
  ) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await operation();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage("Saved.");
      router.refresh();
    } catch {
      setError("The coffee operation could not be completed right now. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="muted"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await recordVisit(expenseId);
              return result.ok ? { ok: true } : { ok: false, error: result.error };
            })
          }
        >
          Count visit
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await classifyAsGroceries(expenseId, version, "groceries");
              return result.ok ? { ok: true } : { ok: false, error: result.error };
            })
          }
        >
          Classify as groceries
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[length:var(--text-meta)] text-[color:var(--ega-danger)]">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
