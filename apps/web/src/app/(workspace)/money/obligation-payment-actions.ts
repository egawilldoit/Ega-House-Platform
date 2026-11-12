"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  correctObligationPayment,
  createAuthenticatedActor,
  payObligation,
  undoObligationPayment,
} from "@ega/application";
import {
  SupabaseObligationPaymentRepository,
  SupabaseObligationRepository,
} from "@ega/data-access";
import type { ExpenseNeedVsWant } from "@ega/domain/expenses";

import { parseMadAmountToMinor } from "@/lib/money/money-amount";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";

/**
 * MONEY-07 web actions for paying, correcting and undoing an obligation.
 *
 * Every action derives the owner from the verified session; no form value can
 * select an owner. The payment, its correction and its undo are single
 * database transactions, so the ledger and the obligation never disagree.
 * Scheduling still posts no cash.
 */

const MONEY_PATHS = ["/money/bills", "/money/subscriptions"] as const;

function returnPath(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  return (MONEY_PATHS as readonly string[]).includes(value)
    ? value
    : "/money/bills";
}

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, field: string): string | null {
  const value = text(formData, field);
  return value === "" ? null : value;
}

function succeed(path: string, notice: string): never {
  revalidatePath("/money");
  revalidatePath("/money/bills");
  revalidatePath("/money/subscriptions");
  redirect(`${path}?${new URLSearchParams({ notice }).toString()}`);
}

function fail(path: string, message: string): never {
  redirect(`${path}?${new URLSearchParams({ error: message }).toString()}`);
}

async function paymentDependencies() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/money/bills");
  const client = await createClient();
  return {
    actor: createAuthenticatedActor(user.id),
    dependencies: {
      obligations: new SupabaseObligationRepository(client),
      payments: new SupabaseObligationPaymentRepository(client),
    },
  };
}

function needVsWantOf(formData: FormData): ExpenseNeedVsWant | null {
  const value = text(formData, "needVsWant");
  return value === "need" || value === "want" ? value : null;
}

function countsInDailyOf(formData: FormData): boolean | undefined {
  const value = text(formData, "countsInDaily");
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * Record one payment for a pending occurrence. The ledger idempotency key is
 * derived from the operation id, so a repeated submission of the same form
 * replays the stored payment instead of paying twice.
 */
export async function payObligationFormAction(
  formData: FormData,
): Promise<void> {
  const path = returnPath(formData.get("returnTo"));
  const operationId = text(formData, "operationId");
  if (!operationId) {
    return fail(path, "This payment form is stale. Reload the page and try again.");
  }

  const needVsWant = needVsWantOf(formData);
  if (!needVsWant) {
    return fail(path, "Choose need or want before paying this obligation.");
  }

  const { actor, dependencies } = await paymentDependencies();
  const result = await payObligation(
    actor,
    dependencies,
    text(formData, "obligationId"),
    {
      version: Number(text(formData, "version")),
      bookingDate: text(formData, "bookingDate"),
      idempotencyKey: `obligation-payment:${operationId}`,
      needVsWant,
      ...(countsInDailyOf(formData) !== undefined
        ? { countsInDaily: countsInDailyOf(formData) }
        : {}),
      ...(optionalText(formData, "paymentMethod")
        ? { paymentMethod: optionalText(formData, "paymentMethod") as never }
        : {}),
    },
    { operationId },
  );

  if (!result.ok) return fail(path, result.errorMessage);
  return succeed(
    path,
    result.data.replayed
      ? "That payment was already recorded; showing the stored payment."
      : "Payment recorded. Cash and the outstanding reserve moved together.",
  );
}

/** Correct the linked payment: amount, booking date and daily flag. */
export async function correctObligationPaymentFormAction(
  formData: FormData,
): Promise<void> {
  const path = returnPath(formData.get("returnTo"));
  const operationId = text(formData, "operationId");
  if (!operationId) {
    return fail(path, "This correction form is stale. Reload the page and try again.");
  }

  const amount = parseMadAmountToMinor(text(formData, "amount"));
  if (!amount.ok) return fail(path, amount.error);

  const { actor, dependencies } = await paymentDependencies();
  const result = await correctObligationPayment(
    actor,
    dependencies,
    text(formData, "obligationId"),
    {
      version: Number(text(formData, "version")),
      amountMinor: amount.value,
      bookingDate: text(formData, "bookingDate"),
      ...(countsInDailyOf(formData) !== undefined
        ? { countsInDaily: countsInDailyOf(formData) }
        : {}),
    },
    { operationId },
  );

  if (!result.ok) return fail(path, result.errorMessage);
  return succeed(
    path,
    result.data.replayed
      ? "That correction was already recorded; showing the stored payment."
      : "Payment corrected. The obligation and the ledger agree again.",
  );
}

/** Undo the linked payment and reopen the obligation. */
export async function undoObligationPaymentFormAction(
  formData: FormData,
): Promise<void> {
  const path = returnPath(formData.get("returnTo"));
  const operationId = text(formData, "operationId");
  if (!operationId) {
    return fail(path, "This undo form is stale. Reload the page and try again.");
  }

  const { actor, dependencies } = await paymentDependencies();
  const result = await undoObligationPayment(
    actor,
    dependencies,
    text(formData, "obligationId"),
    { version: Number(text(formData, "version")) },
    { operationId },
  );

  if (!result.ok) return fail(path, result.errorMessage);
  return succeed(
    path,
    result.data.replayed
      ? "That undo was already recorded; the obligation is already open."
      : "Payment undone. Cash and the outstanding reserve were restored.",
  );
}
