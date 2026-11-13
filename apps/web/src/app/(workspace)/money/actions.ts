"use server";

import { revalidatePath } from "next/cache";

import {
  classifyMoneyExpense,
  closeMoneyDay,
  createAuthenticatedActor,
  createExpense,
  createMoneyPeriod,
  createMovement,
  deleteExpense,
  getExpense,
  recordMoneyCoffeeVisit,
  rebaseMoneyDayStartBaseline,
  saveMoneyBudgetPlan,
  updateExpense,
  updateMoneySettings,
  updateMovement,
} from "@ega/application";
import type { ExpenseDto } from "@ega/contracts/expenses";
import type { MoneyBudgetPlanDto, MoneyMovementDto } from "@ega/contracts/money";
import type { MoneyOpeningInput } from "@ega/domain/money";
import {
  SupabaseExpenseRepository,
  SupabaseMoneyBudgetRepository,
  SupabaseMoneyCoffeeRepository,
  SupabaseMoneyPeriodRepository,
  SupabaseMoneyRepository,
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
  bookingDate?: string;
  amountMinor?: number;
  category?: ExpenseDto["category"];
  needVsWant?: ExpenseDto["needVsWant"];
  merchant?: string | null;
  note?: string | null;
  paymentMethod?: ExpenseDto["paymentMethod"] | null;
  purpose?: ExpenseDto["purpose"];
  countsInDaily?: boolean;
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
      ...(patch.bookingDate !== undefined ? { bookingDate: patch.bookingDate } : {}),
      ...(patch.amountMinor !== undefined ? { amountMinor: patch.amountMinor } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.needVsWant !== undefined ? { needVsWant: patch.needVsWant } : {}),
      ...(patch.merchant !== undefined ? { merchant: patch.merchant } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.paymentMethod !== undefined
        ? { paymentMethod: patch.paymentMethod }
        : {}),
      ...(patch.purpose !== undefined ? { purpose: patch.purpose } : {}),
      ...(patch.countsInDaily !== undefined
        ? { countsInDaily: patch.countsInDaily }
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
    client,
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

/**
 * MONEY-09: close the active day. Final purchases from the same form are
 * recorded first with stable identities; the shared close use case owns the
 * atomic transition. A failed close never pretends the day is closed.
 */
export async function closeMoneyDayAction(
  formData: FormData,
): Promise<MoneyFormActionResult> {
  try {
    const context = await moneyActionContext();
    if (!context) return { ok: false, error: "Sign in to close a Money day." };
    const periodId = formText(formData, "periodId");
    if (!periodId) return { ok: false, error: "A Money period is required." };
    const rawVersion = formText(formData, "version");
    if (!/^\d+$/.test(rawVersion) || Number(rawVersion) < 1) {
      return { ok: false, error: "Reload the page and try again." };
    }
    const operationId = formText(formData, "operationId");
    if (!operationId) {
      return { ok: false, error: "Reload the page and try again." };
    }
    const date = formText(formData, "date");
    const note = formText(formData, "note");
    const rawCount = formText(formData, "finalPurchaseCount") || "0";
    if (!/^\d+$/.test(rawCount) || Number(rawCount) > 20) {
      return { ok: false, error: "Reduce the number of final purchases." };
    }

    const finalPurchases: Array<Record<string, unknown>> = [];
    for (let index = 0; index < Number(rawCount); index += 1) {
      const amountText = formText(formData, `final:${index}:amount`);
      if (!amountText) continue;
      const amount = parseMadAmountToMinor(amountText);
      if (!amount.ok) {
        return { ok: false, error: `Final purchase ${index + 1}: ${amount.error}` };
      }
      const category = formText(formData, `final:${index}:category`);
      if (!EXPENSE_CATEGORY_VALUES.includes(category as ExpenseCategory)) {
        return { ok: false, error: `Final purchase ${index + 1}: choose a category.` };
      }
      const needVsWant = formText(formData, `final:${index}:needVsWant`);
      if (needVsWant !== "need" && needVsWant !== "want") {
        return { ok: false, error: `Final purchase ${index + 1}: choose need or want.` };
      }
      const purpose = formText(formData, `final:${index}:purpose`);
      const countsInDaily = formText(formData, `final:${index}:countsInDaily`);
      const idempotencyKey = formText(formData, `final:${index}:idempotencyKey`);
      if (!idempotencyKey) {
        return { ok: false, error: "Reload the page and try again." };
      }
      finalPurchases.push({
        amountMinor: amount.value,
        category,
        note: formText(formData, `final:${index}:note`) || null,
        merchant: null,
        needVsWant,
        paymentMethod: null,
        purpose: purpose || null,
        ...(countsInDaily === "included"
          ? { countsInDaily: true }
          : countsInDaily === "excluded"
            ? { countsInDaily: false }
            : {}),
        idempotencyKey,
      });
    }

    const result = await closeMoneyDay(
      context.actor,
      {
        periods: context.repository,
        movements: new SupabaseMoneyRepository(context.client),
      },
      {
        version: Number(rawVersion),
        periodId,
        ...(date ? { date } : {}),
        note: note || null,
        operationId,
        finalPurchases,
      },
    );
    if (!result.ok) {
      const committed = result.committedPurchases?.length ?? 0;
      return {
        ok: false,
        error:
          committed > 0
            ? `${result.errorMessage} ${committed} final purchase(s) remain recorded; retry with the same form to close without duplicating them.`
            : result.errorMessage,
      };
    }
    revalidatePath("/money");
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "Unable to close the Money day right now." };
  }
}

/** Deliberately replace the active period's day-start baseline. */
export async function rebaseMoneyDayStartBaselineAction(
  formData: FormData,
): Promise<MoneyFormActionResult> {
  try {
    const context = await moneyActionContext();
    if (!context) return { ok: false, error: "Sign in to rebase the day-start baseline." };
    const periodId = formText(formData, "periodId");
    if (!periodId) return { ok: false, error: "A Money period is required." };
    const result = await rebaseMoneyDayStartBaseline(
      context.actor,
      context.repository,
      periodId,
    );
    if (!result.ok) return { ok: false, error: result.errorMessage };
    revalidatePath("/money");
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "Unable to rebase the day-start baseline right now." };
  }
}

// ---------------------------------------------------------------------------
// MONEY-04: movement mutations. These compose the same application use cases as
// the HTTP route and MCP tools (`createMovement`/`updateMovement`): parsing,
// owner scope, idempotency fingerprint, the shared period guard and optimistic
// concurrency are never re-implemented here.
// ---------------------------------------------------------------------------

export type CreateMovementActionInput = {
  kind: Exclude<MoneyMovementDto["kind"], "opening">;
  /** Required for reconciliation_adjustment; derived otherwise. */
  direction?: MoneyMovementDto["direction"];
  amountMinor: number;
  category?: MoneyMovementDto["category"];
  needVsWant?: MoneyMovementDto["needVsWant"];
  paymentMethod?: MoneyMovementDto["paymentMethod"];
  purpose?: MoneyMovementDto["purpose"];
  countsInDaily?: boolean;
  /** Owner-local booking day; keep the movement date-only unless time is known. */
  bookingDate: string;
  occurredAt?: string | null;
  note?: string | null;
  merchant?: string | null;
  idempotencyKey: string;
};

export type MovementMutationResult =
  | { ok: true; movement: MoneyMovementDto; replayed: boolean }
  | { ok: false; code: ExpenseMutationErrorCode; error: string };

export async function createMovementAction(
  input: CreateMovementActionInput,
): Promise<MovementMutationResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, code: "UNAUTHENTICATED", error: "Sign in to record money movements." };
  }
  const client = await createClient();
  const result = await createMovement(
    createAuthenticatedActor(user.id),
    new SupabaseMoneyRepository(client),
    {
      kind: input.kind,
      direction: input.direction,
      amountMinor: input.amountMinor,
      category: input.category ?? null,
      needVsWant: input.needVsWant ?? null,
      paymentMethod: input.paymentMethod ?? null,
      purpose: input.purpose ?? null,
      ...(input.countsInDaily !== undefined
        ? { countsInDaily: input.countsInDaily }
        : {}),
      bookingDate: input.bookingDate,
      occurredAt: input.occurredAt ?? null,
      note: input.note ?? null,
      merchant: input.merchant ?? null,
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
  revalidatePath("/money");
  revalidatePath("/today");
  return {
    ok: true,
    movement: result.data.movement,
    replayed: result.data.replayed,
  };
}

export type UpdateMovementActionPatch = {
  version: number;
  bookingDate?: string;
  occurredAt?: string | null;
  amountMinor?: number;
  note?: string | null;
  merchant?: string | null;
  purpose?: MoneyMovementDto["purpose"];
  countsInDaily?: boolean;
};

export type UpdateMovementActionResult =
  | { ok: true; movement: MoneyMovementDto }
  | { ok: false; code: ExpenseMutationErrorCode; error: string };

export async function updateMovementAction(
  id: string,
  patch: UpdateMovementActionPatch,
): Promise<UpdateMovementActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, code: "UNAUTHENTICATED", error: "Sign in to correct money movements." };
  }
  const client = await createClient();
  const result = await updateMovement(
    createAuthenticatedActor(user.id),
    new SupabaseMoneyRepository(client),
    id,
    {
      version: patch.version,
      ...(patch.bookingDate !== undefined ? { bookingDate: patch.bookingDate } : {}),
      ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
      ...(patch.amountMinor !== undefined ? { amountMinor: patch.amountMinor } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.merchant !== undefined ? { merchant: patch.merchant } : {}),
      ...(patch.purpose !== undefined ? { purpose: patch.purpose } : {}),
      ...(patch.countsInDaily !== undefined
        ? { countsInDaily: patch.countsInDaily }
        : {}),
    },
    {
      periods: new SupabaseMoneyPeriodRepository(client),
      now: new Date(),
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
  revalidatePath("/today");
  return { ok: true, movement: result.data };
}

/* ------------------------------------------------------------------ */
/* MONEY-05: period budget, counted visits and explicit classification */
/* ------------------------------------------------------------------ */

export type SaveBudgetPlanActionInput = {
  periodStartDate: string;
  periodEndDate: string;
  version: number;
  allocations: Partial<Record<ExpenseCategory, number>>;
  savingsTargetMinor: number | null;
  emergencyTargetMinor: number | null;
  coffeeWeeklySpendLimitMinor: number | null;
  coffeeWeeklyVisitLimit: number | null;
};

export type SaveBudgetPlanActionResult =
  | { ok: true; plan: MoneyBudgetPlanDto }
  | { ok: false; code: ExpenseMutationErrorCode; error: string };

/**
 * Versioned period budget save. The client submits only values and the current
 * version; owner identity comes from the verified session and the plan is
 * attached to the canonical period row. Spending never calls this action.
 */
export async function saveBudgetPlanAction(
  input: SaveBudgetPlanActionInput,
): Promise<SaveBudgetPlanActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, code: "UNAUTHENTICATED", error: "Sign in to edit budgets." };
  }
  const client = await createClient();
  const result = await saveMoneyBudgetPlan(
    createAuthenticatedActor(user.id),
    {
      budgets: new SupabaseMoneyBudgetRepository(client),
      periods: new SupabaseMoneyPeriodRepository(client),
    },
    {
      periodStartDate: input.periodStartDate,
      periodEndDate: input.periodEndDate,
      allocations: input.allocations,
      savingsTargetMinor: input.savingsTargetMinor,
      emergencyTargetMinor: input.emergencyTargetMinor,
      coffeeWeeklySpendLimitMinor: input.coffeeWeeklySpendLimitMinor,
      coffeeWeeklyVisitLimit: input.coffeeWeeklyVisitLimit,
      version: input.version,
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
  return { ok: true, plan: result.data };
}

export type RecordCoffeeVisitActionResult =
  | { ok: true; replayed: boolean }
  | { ok: false; code: ExpenseMutationErrorCode; error: string };

/**
 * Count one ordinary coffee purchase as one visit. The deterministic visit key
 * is the canonical expense id, so a retry replays the same visit instead of
 * inflating the count; the expense row remains the only cash effect.
 */
export async function recordCoffeeVisitAction(
  expenseId: string,
): Promise<RecordCoffeeVisitActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, code: "UNAUTHENTICATED", error: "Sign in to count visits." };
  }
  const client = await createClient();
  const actor = createAuthenticatedActor(user.id);
  const expense = await getExpense(actor, new SupabaseExpenseRepository(client), expenseId);
  if (!expense.ok || !expense.data) {
    return {
      ok: false,
      code: expense.ok ? "NOT_FOUND" : mapApplicationCode(expense.code),
      error: expense.ok ? "Expense was not found." : expense.errorMessage,
    };
  }
  let timezone = "UTC";
  try {
    timezone = (await getWebTimeContext()).timezone;
  } catch {
    timezone = "UTC";
  }
  const result = await recordMoneyCoffeeVisit(
    actor,
    {
      expenses: new SupabaseExpenseRepository(client),
      coffee: new SupabaseMoneyCoffeeRepository(client),
    },
    {
      visitKey: `coffee-expense-${expense.data.id}`,
      // Booking date is the resolved owner-local day even for date-only rows.
      localDate: expense.data.bookingDate,
      timezone,
      expenseIds: [expense.data.id],
      note: null,
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
  return { ok: true, replayed: result.data.replayed };
}

export type ClassifyExpenseActionResult =
  | { ok: true; countedCoffeeUsageChanged: boolean }
  | { ok: false; code: ExpenseMutationErrorCode; error: string };

/**
 * Explicit classification control (for example "Coffee, classify as groceries
 * for testing"). The description/note is preserved unless the caller supplies
 * a replacement, groceries spending increases, and counted coffee usage stays
 * unchanged because no visit is created.
 */
export async function classifyExpenseCategoryAction(
  expenseId: string,
  version: number,
  category: ExpenseCategory,
): Promise<ClassifyExpenseActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, code: "UNAUTHENTICATED", error: "Sign in to edit expenses." };
  }
  const client = await createClient();
  const result = await classifyMoneyExpense(
    createAuthenticatedActor(user.id),
    {
      expenses: new SupabaseExpenseRepository(client),
      coffee: new SupabaseMoneyCoffeeRepository(client),
    },
    { expenseId, version, category },
  );
  if (!result.ok) {
    return {
      ok: false,
      code: mapApplicationCode(result.code),
      error: result.errorMessage,
    };
  }
  revalidatePath("/money");
  return { ok: true, countedCoffeeUsageChanged: result.data.countedCoffeeUsageChanged };
}
