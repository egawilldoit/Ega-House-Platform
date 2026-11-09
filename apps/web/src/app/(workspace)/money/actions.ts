"use server";

import { revalidatePath } from "next/cache";

import {
  createAuthenticatedActor,
  createExpense,
  deleteExpense,
  getExpense,
  updateExpense,
} from "@ega/application";
import type { ExpenseDto } from "@ega/contracts/expenses";
import { SupabaseExpenseRepository } from "@ega/data-access";
import {
  mapApplicationCode,
  type ExpenseMutationErrorCode,
} from "@/lib/money/expense-action-codes";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { EXPENSE_CATEGORY_VALUES, type ExpenseCategory } from "@ega/domain/expenses";
import { parseMadAmountToMinor } from "@/lib/money/money-amount";
import { updateWebUserPreferences } from "@/lib/services/user-preferences-service";

/**
 * Optional per-category monthly caps (PO-08, issue #349). Caps map is saved
 * atomically as one validated preference patch; expense creation is never
 * blocked by a cap.
 */
export async function saveCategoryCapsAction(formData: FormData) {
  const caps: Partial<Record<ExpenseCategory, number>> = {};
  for (const category of EXPENSE_CATEGORY_VALUES) {
    const raw = String(formData.get(`cap:${category}`) ?? "").trim();
    if (raw === "") continue;
    // An explicit zero cap is valid for caps (empty means unset), even though
    // the shared expense-amount parser requires a positive amount there.
    if (raw === "0") {
      caps[category] = 0;
      continue;
    }
    const parsed = parseMadAmountToMinor(raw);
    if (!parsed.ok) {
      return { ok: false as const, error: `${category}: ${parsed.error}` };
    }
    caps[category] = parsed.value;
  }
  const result = await updateWebUserPreferences({ categoryCaps: caps });
  if (result.errorMessage) {
    return { ok: false as const, error: result.errorMessage };
  }
  revalidatePath("/money");
  return { ok: true as const, error: null };
}

/**
 * Authenticated Money mutations (PO-06B integration).
 *
 * Identity is derived server-side from the verified session only. Callers
 * submit expense fields; no payload value can select an owner, and no
 * service-role shortcut is used. Application error codes are mapped onto the
 * six transport codes the mutation components understand (`CONFLICT` drives
 * the edit form's deliberate-reconciliation path).
 */

export type { ExpenseMutationErrorCode } from "@/lib/money/expense-action-codes";

export type CreateExpenseActionInput = {
  occurredAt: string;
  amountMinor: number;
  category: ExpenseDto["category"];
  note: string | null;
  merchant: string | null;
  needVsWant: ExpenseDto["needVsWant"];
  paymentMethod: ExpenseDto["paymentMethod"] | null;
  idempotencyKey: string;
};

export type CreateExpenseActionResult =
  | { ok: true; expense: ExpenseDto; replayed: boolean }
  | { ok: false; code: ExpenseMutationErrorCode; error: string };

export async function createExpenseAction(
  input: CreateExpenseActionInput,
): Promise<CreateExpenseActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, code: "UNAUTHENTICATED", error: "Sign in to add expenses." };
  }
  const client = await createClient();
  const result = await createExpense(
    createAuthenticatedActor(user.id),
    new SupabaseExpenseRepository(client),
    {
      occurredAt: input.occurredAt,
      amountMinor: input.amountMinor,
      category: input.category,
      note: input.note,
      merchant: input.merchant,
      needVsWant: input.needVsWant,
      paymentMethod: input.paymentMethod,
      idempotencyKey: input.idempotencyKey,
    },
  );
  if (!result.ok) {
    return {
      ok: false,
      code: mapApplicationCode(result.code),
      error: result.errorMessage,
    };
  }
  // The quick sheet also lives on Today, whose money card derives from this
  // ledger; revalidate both surfaces so neither shows a stale total.
  revalidatePath("/money");
  revalidatePath("/today");
  return {
    ok: true,
    expense: result.data.expense,
    replayed: result.data.replayed,
  };
}

export type UpdateExpenseActionPatch = {
  version: number;
  occurredAt?: string;
  amountMinor?: number;
  category?: ExpenseDto["category"];
  needVsWant?: ExpenseDto["needVsWant"];
  merchant?: string | null;
  note?: string | null;
  paymentMethod?: ExpenseDto["paymentMethod"] | null;
};

export type UpdateExpenseActionResult =
  | { ok: true; expense: ExpenseDto }
  | { ok: false; code: ExpenseMutationErrorCode; error: string };

export async function updateExpenseAction(
  id: string,
  patch: UpdateExpenseActionPatch,
): Promise<UpdateExpenseActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, code: "UNAUTHENTICATED", error: "Sign in to edit expenses." };
  }
  const client = await createClient();
  const result = await updateExpense(
    createAuthenticatedActor(user.id),
    new SupabaseExpenseRepository(client),
    id,
    {
      version: patch.version,
      ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
      ...(patch.amountMinor !== undefined ? { amountMinor: patch.amountMinor } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.needVsWant !== undefined ? { needVsWant: patch.needVsWant } : {}),
      ...(patch.merchant !== undefined ? { merchant: patch.merchant } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.paymentMethod !== undefined
        ? { paymentMethod: patch.paymentMethod }
        : {}),
    },
  );
  if (!result.ok) {
    return {
      ok: false,
      code: mapApplicationCode(result.code),
      error: result.errorMessage,
    };
  }
  revalidatePath("/money");
  return { ok: true, expense: result.data };
}

export type DeleteExpenseActionResult =
  | { ok: true; alreadyDeleted: boolean }
  | { ok: false; code: ExpenseMutationErrorCode; error: string };

export async function deleteExpenseAction(
  id: string,
): Promise<DeleteExpenseActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, code: "UNAUTHENTICATED", error: "Sign in to delete expenses." };
  }
  const client = await createClient();
  const result = await deleteExpense(
    createAuthenticatedActor(user.id),
    new SupabaseExpenseRepository(client),
    id,
  );
  if (!result.ok) {
    return {
      ok: false,
      code: mapApplicationCode(result.code),
      error: result.errorMessage,
    };
  }
  revalidatePath("/money");
  return { ok: true, alreadyDeleted: result.data.alreadyDeleted };
}

export type GetExpenseActionResult =
  | { ok: true; expense: ExpenseDto }
  | { ok: false; code: ExpenseMutationErrorCode; error: string };

export async function getExpenseAction(
  id: string,
): Promise<GetExpenseActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, code: "UNAUTHENTICATED", error: "Sign in to view expenses." };
  }
  const client = await createClient();
  const result = await getExpense(
    createAuthenticatedActor(user.id),
    new SupabaseExpenseRepository(client),
    id,
  );
  if (!result.ok) {
    return {
      ok: false,
      code: mapApplicationCode(result.code),
      error: result.errorMessage,
    };
  }
  return { ok: true, expense: result.data };
}
