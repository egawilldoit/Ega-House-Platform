/**
 * Fixed synthetic November 2026 workbook for MONEY-001-B acceptance.
 *
 * This data is invented for tests only. It contains no owner, merchant or
 * financial data from a real workbook. Amounts are expressed as workbook MAD
 * values (the parser converts to exact centimes).
 *
 * Expected signed closing:
 *   100.00 + 1.00 - 10.00 - 20.00 - 0.25 - 5.00 - 7.00 = 58.75 MAD
 * The coffee row and both bill rows add no cash. The dashboard and settings
 * rows are metadata only.
 */

export const NOVEMBER_SNAPSHOT_ID = "nov-2026-synthetic";
export const NOVEMBER_WORKBOOK_ID = "synthetic-nov-2026-workbook";
export const NOVEMBER_SOURCE_IDENTITY =
  "synthetic://ega-house/money/2026-11/acceptance-v1";

export const NOVEMBER_CUTOVER = {
  date: "2026-11-01",
  reportedBalanceMinor: 10_000,
  verified: true,
  evidenceRef: "synthetic://verified-cutover/2026-11-01",
  uncoveredDates: [] as string[],
} as const;

function row(
  sourceRowId: string,
  sheet: string,
  rowIndex: number,
  raw: Record<string, unknown>,
) {
  return { sourceRowId, sheet, rowIndex, raw };
}

/** A fresh mutable copy so a test can vary one row without touching another. */
export function novemberWorkbookInput(): Record<string, unknown> {
  return {
    version: "money-001-november-v1",
    snapshotId: NOVEMBER_SNAPSHOT_ID,
    workbookId: NOVEMBER_WORKBOOK_ID,
    sourceIdentity: NOVEMBER_SOURCE_IDENTITY,
    retrievedAt: "2026-11-23T09:00:00.000Z",
    extractionDate: "2026-11-23",
    month: "2026-11",
    timezone: "Africa/Casablanca",
    currency: "MAD",
    tabs: ["Ledger", "Coffee", "Bills", "Dashboard", "Settings"],
    rows: [
      row("O1", "Ledger", 2, {
        type: "opening",
        date: "2026-11-01",
        amount: 100.0,
        description: "Opening balance",
      }),
      row("L1", "Ledger", 3, {
        type: "expense",
        date: "2026-10-30",
        amount: -20.0,
        category: "other",
        needVsWant: "need",
        note: "Pre-cutover purchase",
      }),
      row("L2", "Ledger", 4, {
        type: "income",
        date: "2026-10-31",
        amount: 5.0,
        note: "Pre-cutover income",
      }),
      row("L3", "Ledger", 5, {
        type: "income",
        date: "2026-11-02",
        amount: 1.0,
        note: "Freelance payment",
      }),
      row("L4", "Ledger", 6, {
        type: "expense",
        date: "2026-11-03",
        amount: -10.0,
        category: "coffee",
        needVsWant: "want",
        purpose: "flexible",
        countsInDaily: true,
        merchant: "Cafe Atlas",
        note: "Coffee",
      }),
      row("L5", "Ledger", 7, {
        type: "savings_transfer",
        date: "2026-11-04",
        amount: -20.0,
        note: "Savings transfer",
      }),
      row("L6", "Ledger", 8, {
        type: "reconciliation_adjustment",
        date: "2026-11-05",
        amount: -0.25,
        note: "Round adjustment",
      }),
      row("L7", "Ledger", 9, {
        type: "expense",
        date: "2026-11-06",
        amount: -5.0,
        category: "groceries",
        needVsWant: "need",
        purpose: "flexible",
        countsInDaily: true,
        merchant: "Marjane",
        note: "Groceries",
      }),
      row("L9", "Ledger", 11, {
        type: "expense",
        date: "2026-11-09",
        amount: -7.0,
        category: "bills",
        needVsWant: "need",
        purpose: "fixed",
        countsInDaily: true,
        merchant: "ISP",
        note: "Internet",
      }),
      row("C1", "Coffee", 2, {
        type: "coffee",
        date: "2026-11-03",
        amount: 10.0,
        linkTo: "L4",
        merchant: "Cafe Atlas",
        note: "Cafe visit",
      }),
      row("B1", "Bills", 2, {
        type: "bill",
        dueDate: "2026-11-15",
        amount: 30.0,
        paid: false,
        description: "Internet",
      }),
      row("B2", "Bills", 3, {
        type: "bill",
        dueDate: "2026-11-09",
        amount: 7.0,
        paid: true,
        linkTo: "L9",
        description: "Internet",
      }),
      row("D1", "Dashboard", 2, {
        type: "dashboard",
        date: "2026-11-30",
        reportedClosing: 58.75,
      }),
      row("S1", "Settings", 2, {
        type: "settings",
        savingsTarget: 20.0,
      }),
    ],
  };
}
