import { createClient } from "@/lib/supabase/server";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { toCsvDocument } from "@/lib/csv";
import { captureServerException } from "@/lib/monitoring/capture-server-exception";
import { getLocalDayWindow, isIsoDate } from "@ega/domain/time-context";

export const dynamic = "force-dynamic";

/** Bounded owner expense export (PO-15, issue #360). */
export const MAX_EXPORT_DAYS = 93;

export function parseExpenseExportParams(searchParams: URLSearchParams) {
  const from = searchParams.get("from")?.trim() ?? "";
  const to = searchParams.get("to")?.trim() ?? "";
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  if (to < from) return null;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_EXPORT_DAYS) return null;
  return { from, to };
}

export function buildExpenseExportCsv(rows: Array<{
  occurredAt: string;
  amountMinor: number;
  category: string;
  merchant: string | null;
  note: string | null;
  needVsWant: string;
  paymentMethod: string | null;
}>, timezone: string) {
  return toCsvDocument(
    ["occurred_at", "amount_minor", "amount_mad", "category", "merchant", "note", "need_vs_want", "payment_method", "timezone"],
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
    return Response.json({ error: "Use a bounded from/to date range (max 93 days)." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const ownerUserId = authData.user.id;

  let timezone = "UTC";
  try {
    timezone = (await getWebTimeContext()).timezone;
  } catch {
    timezone = "UTC";
  }

  // Owner-local half-open bounds for the selected range.
  let startUtc: string;
  let endUtcExclusive: string;
  try {
    startUtc = getLocalDayWindow(timezone, params.from).startUtcIso;
    endUtcExclusive = getLocalDayWindow(timezone, params.to).endUtcIso;
  } catch {
    return Response.json({ error: "Unable to resolve the export range." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("personal_expenses")
    .select("occurred_at, amount_minor, category, merchant, note, need_vs_want, payment_method")
    .eq("owner_user_id", ownerUserId)
    .is("deleted_at", null)
    .gte("occurred_at", startUtc)
    .lt("occurred_at", endUtcExclusive)
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(10000);

  if (error) {
    captureServerException(error, { area: "route.expense-export", operation: "load_expenses" });
    return Response.json({ error: "Unable to load expenses right now." }, { status: 500 });
  }

  const csv = buildExpenseExportCsv(
    (data ?? []).map((row) => ({
      occurredAt: String(row.occurred_at),
      amountMinor: Number(row.amount_minor),
      category: String(row.category),
      merchant: row.merchant == null ? null : String(row.merchant),
      note: row.note == null ? null : String(row.note),
      needVsWant: String(row.need_vs_want),
      paymentMethod: row.payment_method == null ? null : String(row.payment_method),
    })),
    timezone,
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ega-expenses-${params.from}-${params.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
