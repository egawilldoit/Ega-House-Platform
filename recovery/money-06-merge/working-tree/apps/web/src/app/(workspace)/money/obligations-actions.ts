"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createAuthenticatedActor,
  createObligation,
  createObligationTemplate,
  generateObligations,
  transitionObligation,
  updateObligation,
  updateObligationTemplate,
} from "@ega/application";
import { SupabaseObligationRepository } from "@ega/data-access";
import type { ObligationKind, ObligationState } from "@ega/domain/obligations";

import { parseMadAmountToMinor } from "@/lib/money/money-amount";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";

/**
 * MONEY-06 web actions for bills and subscriptions.
 *
 * Every action derives the owner from the verified session; no form value can
 * select an owner. The same application use cases back the MCP tools, so there
 * is one lifecycle and one calculation. Scheduling, editing or cancelling never
 * posts a cash movement — only the (MONEY-07) atomic payment path does.
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

function succeed(
  path: string,
  notice: string,
  options: Readonly<{ offset?: string }> = {},
): never {
  revalidatePath("/money");
  revalidatePath("/money/bills");
  revalidatePath("/money/subscriptions");
  const params = new URLSearchParams({ notice });
  if (options.offset) params.set("offset", options.offset);
  redirect(`${path}?${params.toString()}`);
}

function fail(path: string, message: string): never {
  redirect(`${path}?${new URLSearchParams({ error: message }).toString()}`);
}

async function repositoryAndActor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/money/bills");
  const client = await createClient();
  return {
    actor: createAuthenticatedActor(user.id),
    repository: new SupabaseObligationRepository(client),
  };
}

export async function createObligationFormAction(
  formData: FormData,
): Promise<void> {
  const path = returnPath(formData.get("returnTo"));
  const amount = parseMadAmountToMinor(text(formData, "amount"));
  if (!amount.ok) return fail(path, amount.error);

  const { actor, repository } = await repositoryAndActor();
  const kind = text(formData, "kind") as ObligationKind;
  const purpose = text(formData, "purpose");
  const countsInDaily = text(formData, "countsInDaily");
  const needVsWant = text(formData, "needVsWant");
  const category = text(formData, "category");
  const templateId = optionalText(formData, "templateId");

  const result = await createObligation(actor, repository, {
    kind,
    description: text(formData, "description"),
    amountMinor: amount.value,
    dueDate: text(formData, "dueDate"),
    ...(optionalText(formData, "periodStart")
      ? { periodStart: text(formData, "periodStart") }
      : {}),
    ...(optionalText(formData, "periodEnd")
      ? { periodEnd: text(formData, "periodEnd") }
      : {}),
    templateId: templateId ?? undefined,
    // An empty need/want stays unknown; it is requested at payment time.
    needVsWant:
      needVsWant === "need" || needVsWant === "want" ? needVsWant : null,
    ...(purpose ? { purpose: purpose as "fixed" | "flexible" | "emergency" } : {}),
    ...(countsInDaily === "true"
      ? { countsInDaily: true }
      : countsInDaily === "false"
        ? { countsInDaily: false }
        : {}),
    category: category ? (category as never) : null,
    stateEffectiveDate: text(formData, "stateEffectiveDate"),
    idempotencyKey: text(formData, "idempotencyKey"),
  });

  if (!result.ok) return fail(path, result.errorMessage);
  return succeed(
    path,
    result.data.replayed
      ? "That obligation was already recorded; showing the stored occurrence."
      : "Obligation recorded as pending. No cash movement was posted.",
  );
}

export async function updateObligationFormAction(
  formData: FormData,
): Promise<void> {
  const path = returnPath(formData.get("returnTo"));
  const amount = parseMadAmountToMinor(text(formData, "amount"));
  if (!amount.ok) return fail(path, amount.error);

  const { actor, repository } = await repositoryAndActor();
  const purpose = text(formData, "purpose");
  const countsInDaily = text(formData, "countsInDaily");
  const needVsWant = text(formData, "needVsWant");
  const category = text(formData, "category");

  const result = await updateObligation(
    actor,
    repository,
    text(formData, "obligationId"),
    {
      version: Number(text(formData, "version")),
      description: text(formData, "description"),
      amountMinor: amount.value,
      dueDate: text(formData, "dueDate"),
      ...(optionalText(formData, "periodStart")
        ? { periodStart: text(formData, "periodStart") }
        : {}),
      ...(optionalText(formData, "periodEnd")
        ? { periodEnd: text(formData, "periodEnd") }
        : {}),
      needVsWant:
        needVsWant === "need" || needVsWant === "want" ? needVsWant : null,
      ...(purpose ? { purpose: purpose as "fixed" | "flexible" | "emergency" } : {}),
      ...(countsInDaily === "true"
        ? { countsInDaily: true }
        : countsInDaily === "false"
          ? { countsInDaily: false }
          : {}),
      category: category ? (category as never) : null,
    },
  );
  if (!result.ok) return fail(path, result.errorMessage);
  return succeed(path, "Obligation updated.");
}

export async function transitionObligationFormAction(
  formData: FormData,
): Promise<void> {
  const path = returnPath(formData.get("returnTo"));
  const { actor, repository } = await repositoryAndActor();
  const result = await transitionObligation(
    actor,
    repository,
    text(formData, "obligationId"),
    {
      version: Number(text(formData, "version")),
      to: text(formData, "to") as ObligationState,
      effectiveDate: text(formData, "effectiveDate"),
      reason: optionalText(formData, "reason"),
    },
  );
  if (!result.ok) return fail(path, result.errorMessage);
  const label = result.data.state.replaceAll("_", " ");
  return succeed(
    path,
    `Obligation is now ${label}. No cash movement was posted.`,
  );
}

export async function createTemplateFormAction(
  formData: FormData,
): Promise<void> {
  const path = returnPath(formData.get("returnTo"));
  const amount = parseMadAmountToMinor(text(formData, "amount"));
  if (!amount.ok) return fail(path, amount.error);

  const { actor, repository } = await repositoryAndActor();
  const cadence = text(formData, "cadence");
  const dueDayOfMonth = optionalText(formData, "dueDayOfMonth");
  const dueWeekday = optionalText(formData, "dueWeekday");
  const purpose = text(formData, "purpose");
  const countsInDaily = text(formData, "countsInDaily");
  const needVsWant = text(formData, "needVsWant");
  const category = text(formData, "category");

  const result = await createObligationTemplate(actor, repository, {
    kind: text(formData, "kind") as ObligationKind,
    description: text(formData, "description"),
    amountMinor: amount.value,
    cadence: cadence as never,
    ...(dueDayOfMonth ? { dueDayOfMonth: Number(dueDayOfMonth) } : {}),
    ...(dueWeekday ? { dueWeekday: Number(dueWeekday) } : {}),
    startDate: text(formData, "startDate"),
    endDate: optionalText(formData, "endDate"),
    needVsWant:
      needVsWant === "need" || needVsWant === "want" ? needVsWant : null,
    ...(purpose ? { purpose: purpose as "fixed" | "flexible" | "emergency" } : {}),
    ...(countsInDaily === "true"
      ? { countsInDaily: true }
      : countsInDaily === "false"
        ? { countsInDaily: false }
        : {}),
    category: category ? (category as never) : null,
    idempotencyKey: text(formData, "idempotencyKey"),
  });
  if (!result.ok) return fail(path, result.errorMessage);
  return succeed(
    path,
    "Recurring template saved. Templates never post cash; generate occurrences to schedule them.",
  );
}

export async function updateTemplateFormAction(
  formData: FormData,
): Promise<void> {
  const path = returnPath(formData.get("returnTo"));
  const { actor, repository } = await repositoryAndActor();
  const action = text(formData, "templateAction");
  const lifecycle =
    action === "archive" ? "archived" : action === "activate" ? "active" : null;

  const result = await updateObligationTemplate(
    actor,
    repository,
    text(formData, "templateId"),
    {
      version: Number(text(formData, "version")),
      ...(lifecycle ? { lifecycle } : {}),
    },
  );
  if (!result.ok) return fail(path, result.errorMessage);
  return succeed(
    path,
    lifecycle === "archived"
      ? "Template archived. Existing occurrences are unchanged."
      : "Template reactivated.",
  );
}

export async function generateObligationsFormAction(
  formData: FormData,
): Promise<void> {
  const path = returnPath(formData.get("returnTo"));
  const { actor, repository } = await repositoryAndActor();
  const result = await generateObligations(actor, repository, {
    templateId: text(formData, "templateId"),
    throughDate: text(formData, "throughDate"),
  });
  if (!result.ok) return fail(path, result.errorMessage);
  const { created, existing, truncated } = result.data;
  return succeed(
    path,
    truncated
      ? `Generated ${created} occurrence(s); ${existing} already existed. The generation cap was reached, so run it again for later periods.`
      : `Generated ${created} occurrence(s); ${existing} already existed.`,
  );
}
