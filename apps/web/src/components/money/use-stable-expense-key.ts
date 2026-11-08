"use client";

import { useState } from "react";

import {
  createExpenseIdempotencyKey,
  isExpenseIdempotencyKey,
} from "@/lib/money/expense-idempotency";
import type { ExpenseDto } from "@ega/contracts/expenses";

/**
 * Owns one stable idempotency key per logical purchase.
 *
 * The key is created once, survives re-renders/timeout/retry, and rotates
 * only when `purchaseNonce` changes (genuinely new purchase) or `ownerKey`
 * changes (account switch — a new owner must never reuse the old key).
 */
export function useStableIdempotencyKey(options: {
  ownerKey: string;
  purchaseNonce: string | number;
  initialKey?: string;
}): [key: string, rotate: () => string] {
  const { ownerKey, purchaseNonce, initialKey } = options;
  const scope = `${ownerKey}::${purchaseNonce}`;
  // Render-time scope adjustment (same pattern as QuickTaskSheetPanel): a new
  // purchase or owner rotates the key during render, never per attempt, and
  // retries keep the identical key.
  const [scoped, setScoped] = useState(() => ({
    scope,
    key:
      initialKey && isExpenseIdempotencyKey(initialKey)
        ? initialKey.trim()
        : createExpenseIdempotencyKey(),
  }));
  if (scoped.scope !== scope) {
    setScoped({ scope, key: createExpenseIdempotencyKey() });
  }

  return [
    scoped.key,
    () => {
      const next = createExpenseIdempotencyKey();
      setScoped({ scope, key: next });
      return next;
    },
  ];
}

export type { ExpenseDto };
