"use server";

import { revalidatePath } from "next/cache";

import {
  createAuthenticatedActor,
  createExpense,
  createMoneyPeriod,
  deleteExpense,
  getExpense,
  updateExpense,
  updateMoneySettings,
} from "@ega/application";
import type { ExpenseDto } from "@ega/contracts/expenses";
import type { MoneyOpeningInput } from "@ega/domain/money";
import {
  SupabaseExpenseRepository,
  SupabaseMoneyPeriodRepository,
} from "@ega/data-access";
import {
  mapApplicationCode,
  type ExpenseMutationErrorCode,
} from "@/lib/money/expense-action-codes";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { EXPENSE_CATEGORY_VALUES, type ExpenseCategory } from "@ega/domain/expenses";
import {
  parseMadAmountToMinor,
  parseOpeningAmountToMinor,
} from "@/lib/money/money-amount";
import { getWebTimeContext } from "@/lib/services/time-context-service";
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
    { periods: new SupabaseMoneyPeriodRepository(client) },
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
    { periods: new SupabaseMoneyPeriodRepository(client) },
  );
  if (!result.ok) {
    return {
      ok: false,
      code: mapApplicationCode(result.code),
      error: result.errorMessage,
    };
  }
  // Edits change the same day/week/month/category/coffee projections Today
  // shows, so both surfaces must revalidate (never a new realtime subsystem).
  revalidatePath("/money");
  revalidatePath("/today");
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
  revalidatePath("/today");
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

// ---------------------------------------------------------------------------
// MONEY-03: period setup and settings. Both actions compose the same
// application use cases as MCP; identity is the verified session only.
// ---------------------------------------------------------------------------

export type MoneyFormActionResult =
  | { ok: true; error: null }
  | { ok: false; error: string };

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function openingFromForm(
  formData: FormData,
  mode: string,
): { ok: true; value: MoneyOpeningInput | null } | { ok: false; error: string } {
  if (mode === "" || mode === "unknown" || mode === "unchanged") {
    return { ok: true, value: null };
  }
  if (mode !== "known" && mode !== "verified") {
    return { ok: false, error: "Choose a supported opening source." };
  }
  const rawAmount = formText(formData, "openingAmount");
  if (!rawAmount) {
    return {
      ok: false,
      error: "Enter the known opening cash, or choose unknown cash.",
    };
  }
  const amount = parseOpeningAmountToMinor(rawAmount);
  if (!amount.ok) return { ok: false, error: amount.error };
  return {
    ok: true,
    value: {
      amountMinor: amount.value,
      source: mode === "verified" ? "verified_source" : "user_entered",
      cutoffDate: formText(formData, "openingCutoffDate") || null,
      evidence: formText(formData, "openingEvidence") || null,
      note: formText(formData, "openingNote") || null,
    },
  };
}

async function moneyActionContext() {
  const user = await getCurrentUser();
  if (!user) return null;
  const client = await createClient();
  const time = await getWebTimeContext();
  return {
    actor: createAuthenticatedActor(user.id),
    repository: new SupabaseMoneyPeriodRepository(client),
    now: new Date(),
    timezone: time.persistedTimezone,
  };
}

/** Create one inclusive period with unknown, known-zero or verified opening. */
export async function createMoneyPeriodAction(
  formData: FormData,
): Promise<MoneyFormActionResult> {
  try {
    const context = await moneyActionContext();
    if (!context) return { ok: false, error: "Sign in to configure Money." };

    const startDate = formText(formData, "startDate");
    const endDate = formText(formData, "endDate");
    const activeDate = formText(formData, "activeDate");
    const timezone = formText(formData, "timezone");
    const openingMode = formText(formData, "openingMode") || "unknown";
    const opening = openingFromForm(formData, openingMode);
    if (!opening.ok) return { ok: false, error: opening.error };

    const input: Record<string, unknown> = {
      startDate,
      endDate,
      opening: opening.value,
    };
    if (activeDate) input.activeDate = activeDate;
    if (timezone) input.timezone = timezone;

    const result = await createMoneyPeriod(
      context.actor,
      context.repository,
      input,
      {
        now: context.now,
        timezone: context.timezone,
        surface: "web",
      },
    );
    if (!result.ok) return { ok: false, error: result.errorMessage };
    revalidatePath("/money");
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "Unable to save the Money period right now." };
  }
}

/** Update the active date and/or initialize/correct the single opening. */
export async function updateMoneySettingsAction(
  formData: FormData,
): Promise<MoneyFormActionResult> {
  try {
    const context = await moneyActionContext();
    if (!context) return { ok: false, error: "Sign in to update Money settings." };

    const periodId = formText(formData, "periodId");
    if (!periodId) return { ok: false, error: "A Money period is required." };
    const rawVersion = formText(formData, "version");
    if (!/^\d+$/.test(rawVersion) || Number(rawVersion) < 1) {
      return { ok: false, error: "Reload the page and try again." };
    }

    const input: Record<string, unknown> = { version: Number(rawVersion) };
    const activeDate = formText(formData, "activeDate");
    if (activeDate) input.activeDate = activeDate;

    const openingMode = formText(formData, "openingMode") || "unchanged";
    if (openingMode !== "unchanged") {
      const opening = openingFromForm(formData, openingMode);
      if (!opening.ok) return { ok: false, error: opening.error };
      if (opening.value === null) {
        return { ok: false, error: "Choose known or verified opening cash." };
      }
      input.opening = opening.value;
    }

    const result = await updateMoneySettings(
      context.actor,
      context.repository,
      periodId,
      input,
      { now: context.now, timezone: context.timezone },
    );
    if (!result.ok) return { ok: false, error: result.errorMessage };
    revalidatePath("/money");
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "Unable to save Money settings right now." };
  }
}
