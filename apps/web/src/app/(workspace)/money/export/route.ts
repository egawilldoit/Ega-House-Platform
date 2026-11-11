import { createClient } from "@/lib/supabase/server";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { toCsvDocument } from "@/lib/csv";
import { captureServerException } from "@/lib/monitoring/capture-server-exception";
import {
  createAuthenticatedActor,
  exportExpenses,
  EXPENSE_EXPORT_MAX_ROWS,
} from "@ega/application";
import { SupabaseExpenseRepository } from "@ega/data-access";
import { getLocalDayWindow, isIsoDate } from "@ega/domain/time-context";

export const dynamic = "force-dynamic";

/**
 * Bounded owner expense export (PO-15, issue #360; MONEY-02 completeness).
 *
 * The route keeps its explicit 93-day window but no longer relies on a single
 * 10,000-row page. `exportExpenses` walks the canonical repository to
 * exhaustion and refuses explicitly if the row budget is exceeded, so a
 * downloaded file is either complete or the request fails with a reason.
 */
export const MAX_EXPORT_DAYS = 93;

export function parseExpenseExportParams(searchParams: URLSearchParams) {
  const from = searchParams.get("from")?.trim() ?? "";
  const to = searchParams.get("to")?.trim() ?? "";
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  if (to < from) return null;
  const days =
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  if (days > MAX_EXPORT_DAYS) return null;
  return { from, to };
}

export function buildExpenseExportCsv(
  rows: Array<{
    occurredAt: string;
    amountMinor: number;
    category: string;
    merchant: string | null;
    note: string | null;
    needVsWant: string;
    paymentMethod: string | null;
  }>,
  timezone: string,
) {
  return toCsvDocument(
    [
      "occurred_at",
      "amount_minor",
      "amount_mad",
      "category",
      "merchant",
      "note",
      "need_vs_want",
      "payment_method",
      "timezone",
    ],
    rows.map((row) => [
      row.occurredAt,
      row.amountMinor,
      (row.amountMinor / 100).toFixed(2),
      row.category,
      row.merchant,
      row.note,
      row.needVsWant,
      row.paymentMethod,
      timezone,
    ]),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = parseExpenseExportParams(url.searchParams);
  if (!params) {
    return Response.json(
      { error: "Use a bounded from/to date range (max 93 days)." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const ownerUserId = authData.user.id;

  let timezone: string;
  try {
    timezone = (await getWebTimeContext()).timezone;
  } catch {
    timezone = "UTC";
  }

  // Validate the owner-local window once here for a clear range error before
  // the canonical export walks pages.
  try {
    getLocalDayWindow(timezone, params.from);
    getLocalDayWindow(timezone, params.to);
  } catch {
    return Response.json(
      { error: "Unable to resolve the export range." },
      { status: 400 },
    );
  }

  const exported = await exportExpenses(
    createAuthenticatedActor(ownerUserId),
    new SupabaseExpenseRepository(supabase),
    { from: params.from, to: params.to, timezone },
  );
  if (!exported.ok) {
    if (exported.reason === "export_too_large") {
      return Response.json(
        { error: exported.errorMessage, maxRows: EXPENSE_EXPORT_MAX_ROWS },
        { status: 413 },
      );
    }
    if (exported.code === "validation") {
      return Response.json({ error: exported.errorMessage }, { status: 400 });
    }
    captureServerException(new Error(exported.code ?? "unknown"), {
      area: "route.expense-export",
      operation: "export_expenses",
    });
    return Response.json(
      { error: "Unable to load expenses right now." },
      { status: exported.code === "forbidden" ? 403 : 500 },
    );
  }

  const csv = buildExpenseExportCsv(
    exported.data.expenses.map((row) => ({
      occurredAt: row.occurredAt,
      amountMinor: row.amountMinor,
      category: row.category,
      merchant: row.merchant,
      note: row.note,
      needVsWant: row.needVsWant,
      paymentMethod: row.paymentMethod,
    })),
    timezone,
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ega-expenses-${params.from}-${params.to}.csv"`,
      "Cache-Control": "private, no-store",
      "X-EGA-Export-Rows": String(exported.data.recordCount),
    },
  });
}
