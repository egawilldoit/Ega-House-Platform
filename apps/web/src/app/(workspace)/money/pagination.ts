/**
 * URL state for the two independent Money ledgers. This is web transport
 * concern only: which rows are returned stays with the application queries.
 */
export const MONEY_PAGE_SIZE = 25;
export const MAX_MONEY_PAGER_OFFSET = 100_000;

export type MoneyPagerParams = Readonly<{
  offset?: string;
  expenseOffset?: string;
  movementOffset?: string;
}>;

export type MoneyPagerState = Readonly<{
  expenseOffset: number;
  movementOffset: number;
}>;

export type MoneyPageState = MoneyPagerState & Readonly<{
  periodId: string | null;
}>;

function parsePagerOffset(raw: string | undefined): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? Math.min(parsed, MAX_MONEY_PAGER_OFFSET) : 0;
}

/**
 * A legacy `offset` link seeds both pagers, preserving the old shared-page
 * behaviour. A dedicated parameter always wins for its own pager and leaves
 * the other pager untouched. Invalid values fall back to zero and excessive
 * values clamp to the existing bound.
 */
export function resolveMoneyPagerOffsets(params: MoneyPagerParams): MoneyPagerState {
  const legacyOffset = parsePagerOffset(params.offset);
  return {
    expenseOffset:
      params.expenseOffset === undefined
        ? legacyOffset
        : parsePagerOffset(params.expenseOffset),
    movementOffset:
      params.movementOffset === undefined
        ? legacyOffset
        : parsePagerOffset(params.movementOffset),
  };
}

/** Build a Money URL that keeps the selected period and the other pager's page. */
export function moneyHref(state: MoneyPageState): string {
  const params = new URLSearchParams();
  if (state.periodId) params.set("periodId", state.periodId);
  if (state.expenseOffset > 0) params.set("expenseOffset", String(state.expenseOffset));
  if (state.movementOffset > 0) params.set("movementOffset", String(state.movementOffset));
  const query = params.toString();
  return query ? `/money?${query}` : "/money";
}
