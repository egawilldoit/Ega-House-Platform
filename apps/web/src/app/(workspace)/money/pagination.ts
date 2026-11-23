import type { MoneyKind } from "@ega/domain/money";

/**
 * URL state for the one Money history. This is web transport concern only:
 * which rows are returned stays with the canonical `listMovements` query.
 */
export const MONEY_PAGE_SIZE = 25;
export const MAX_MONEY_PAGER_OFFSET = 100_000;

export const MONEY_HISTORY_KIND_OPTIONS = [
  { value: "", label: "All movements" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
  { value: "savings_transfer", label: "Savings transfers" },
  { value: "reconciliation_adjustment", label: "Reconciliation adjustments" },
  { value: "opening", label: "Opening cash" },
] as const;

export type MoneyHistoryKind = (typeof MONEY_HISTORY_KIND_OPTIONS)[number];

export type MoneyHistoryParams = Readonly<{
  offset?: string;
  /** Legacy independent pager parameters; accepted without splitting history. */
  expenseOffset?: string;
  movementOffset?: string;
  kind?: string;
  periodId?: string;
}>;

export type MoneyHistoryState = Readonly<{
  offset: number;
  kind: MoneyKind | null;
}>;

function parsePagerOffset(raw: string | undefined): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? Math.min(parsed, MAX_MONEY_PAGER_OFFSET) : 0;
}

/**
 * The unified history uses `offset`. A legacy `expenseOffset`/`movementOffset`
 * link still lands on a bounded page instead of failing; it never recreates two
 * tables. An invalid kind falls back to all movements.
 */
export function resolveMoneyHistoryState(params: MoneyHistoryParams): MoneyHistoryState {
  const legacyOffset =
    params.offset ??
    params.expenseOffset ??
    params.movementOffset;
  return {
    offset: parsePagerOffset(legacyOffset),
    kind: parseMoneyHistoryKind(params.kind),
  };
}

export function parseMoneyHistoryKind(raw: string | undefined): MoneyKind | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  const match = MONEY_HISTORY_KIND_OPTIONS.find(
    (option) => option.value !== "" && option.value === value,
  );
  return match ? (match.value as MoneyKind) : null;
}

/** Build a Money URL that keeps the selected period, page and kind filter. */
export function moneyHref(state: Readonly<{
  periodId: string | null;
  offset: number;
  kind: MoneyKind | null;
}>): string {
  const params = new URLSearchParams();
  if (state.periodId) params.set("periodId", state.periodId);
  if (state.offset > 0) params.set("offset", String(state.offset));
  if (state.kind) params.set("kind", state.kind);
  const query = params.toString();
  return query ? `/money?${query}` : "/money";
}
