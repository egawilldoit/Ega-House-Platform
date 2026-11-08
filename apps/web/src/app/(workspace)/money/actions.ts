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
  revalidatePath("/money");
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
