import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createAuthenticatedActor, listMovements } from "@ega/application";
import type { MoneyMovementRepository } from "@ega/application";

const source = readFileSync(resolve(import.meta.dirname, "./page.tsx"), "utf8");
const summarySource = readFileSync(
  resolve(import.meta.dirname, "./_components/money-primary-summary.tsx"),
  "utf8",
);
const quickEntrySource = readFileSync(
  resolve(import.meta.dirname, "./_components/money-quick-entry.tsx"),
  "utf8",
);
const historySource = readFileSync(
  resolve(import.meta.dirname, "./_components/money-history.tsx"),
  "utf8",
);
const overviewSource = readFileSync(
  resolve(import.meta.dirname, "./_components/money-overview-panels.tsx"),
  "utf8",
);

test("money page derives actor from verified user and never accepts an owner", () => {
  assert.match(source, /getCurrentUser\(\)/);
  assert.match(source, /createAuthenticatedActor\(user\.id\)/);
  assert.doesNotMatch(source, /owner_user_id\s*:/);
});

test("money page honors owner timezone and the shared ledger reads", () => {
  assert.match(source, /getWebTimeContext\(\)/);
  assert.match(source, /time\.persistedTimezone\s*\?\?\s*MONEY_DEFAULT_TIMEZONE/);
  assert.match(source, /timezone,/);
  assert.match(source, /getMoneyState\(/);
  assert.match(source, /SupabaseMoneyPeriodRepository/);
});

test("one primary summary shows recorded cash, safe to spend and the daily reference", () => {
  assert.match(source, /MoneyPrimarySummary/);
  assert.match(source, /getCurrentMoneyReserves\(actor/);
  assert.match(source, /cutoffDate: moneyState\.dateResolution\.projectionCutoffDate/);
  assert.match(source, /localToday: moneyState\.localToday/);
  assert.match(source, /reserve=\{reserveResult\}/);
  assert.match(summarySource, /money-recorded-cash/);
  assert.match(summarySource, /data-minor=\{cash\.recordedCashMinor\}/);
  assert.match(summarySource, /data-basis=\{cash\.basis\}/);
  assert.match(summarySource, /money-safe-to-spend/);
  assert.match(summarySource, /safeFlexibleMinor/);
  assert.match(summarySource, /money-daily-reference/);
  assert.match(summarySource, /money-daily-remaining/);
  assert.match(summarySource, /data-date=\{reference\.date\}/);
  assert.match(summarySource, /data-basis=\{reference\.basis\}/);
  assert.match(summarySource, /Day-start reference/);
  assert.match(summarySource, /unverifiedDayCount/);
  assert.match(summarySource, /unavailable —/i);
  assert.doesNotMatch(summarySource, /safeFlexibleMinor\s*\?\?\s*0/);
});

test("one quick entry posts every movement kind through the shared movement use case", () => {
  assert.match(source, /MoneyQuickEntry/);
  assert.match(source, /defaultBookingDate=\{localToday\}/);
  assert.match(quickEntrySource, /createMovementAction/);
  for (const kind of ["expense", "income", "savings_transfer", "reconciliation_adjustment"]) {
    assert.match(quickEntrySource, new RegExp(kind));
  }
  assert.match(quickEntrySource, /useStableIdempotencyKey/);
  assert.match(quickEntrySource, /aria-label="Quick financial entry"/);
  assert.match(quickEntrySource, /role="alert"/);
  assert.doesNotMatch(quickEntrySource, /createExpenseAction|ExpenseCreateForm/);
});

test("one unified history lists every kind through a single paginated movement query", () => {
  assert.match(source, /listMovements\(/);
  assert.match(source, /limit:\s*String\(MONEY_PAGE_SIZE\)/);
  assert.match(source, /offset:\s*String\(offset\)/);
  assert.match(source, /scope === "period" && moneyState\?\.period/);
  assert.match(source, /from:\s*moneyState\.period\.startDate/);
  assert.match(source, /to:\s*moneyState\.period\.endDate/);
  assert.match(historySource, /Show all history/);
  assert.match(source, /\.\.\.\(kind \? \{ kind \} : \{\}\)/);
  assert.match(source, /MoneyHistory/);
  assert.doesNotMatch(source, /listExpenses\(/);
  assert.doesNotMatch(source, /excludeKind/);
  assert.doesNotMatch(source, /MoneyCreatePanel|MoneyMovementPanel/);
  assert.match(historySource, /MoneyRowActions/);
  assert.match(historySource, /MoneyMovementActions/);
  assert.match(historySource, /aria-label="Movement history pages"/);
  assert.match(historySource, /Movement history could not be loaded/);
  assert.match(historySource, /No movements recorded yet/);
  assert.match(historySource, /Totals are a lower bound/);
});

test("advanced capabilities remain reachable as secondary sections", () => {
  for (const target of [
    "#money-savings",
    "#money-budget",
    "#money-export",
    "#money-period",
    "#money-close",
    "#money-rollover",
    "/money/recurring",
  ]) {
    assert.match(source, new RegExp(target.replace("#", "#")));
  }
  assert.match(source, /MoneyReservesPanel/);
  assert.match(source, /MoneyBudgetPlanPanel/);
  assert.match(source, /MoneyCapsPanel/);
  assert.match(source, /MoneyExportPanel/);
  assert.match(source, /MoneyPeriodPanel/);
  assert.match(source, /MoneyDayClosePanel/);
  assert.match(source, /MoneyRolloverPanel/);
  assert.match(source, /MoneyRolloverVariancePanel/);
  assert.match(overviewSource, /action="\/money\/export"/);
  assert.match(overviewSource, /Download CSV/);
});

test("day close is optional and the page exposes unverified days", () => {
  assert.match(source, /MoneyDayClosePanel/);
  assert.match(source, /unverifiedDates=\{moneyState\.unverifiedDates\}/);
  assert.match(source, /unverifiedDayCount=\{moneyState\.unverifiedDayCount\}/);
  assert.match(source, /closeMoneyDayAction/);
  const dayCloseSource = readFileSync(
    resolve(import.meta.dirname, "./_components/money-day-close-panel.tsx"),
    "utf8",
  );
  assert.match(dayCloseSource, /Day close is optional/);
  assert.match(dayCloseSource, /no fabricated close row/);
});

test("finalization previews a tracking or ended source with retained acknowledgment", () => {
  assert.match(source, /getMoneyRolloverPreviewForPeriod\(/);
  assert.match(source, /moneyState\.period\.lifecycle === "ended"/);
  assert.match(source, /moneyState\.period\.lifecycle === "tracking"/);
  assert.match(source, /rolloverMoneyPeriodAction/);
  assert.match(source, /listMoneyRolloverBridges\(/);
  assert.match(source, /bridges=\{rolloverBridges\}/);
  assert.match(source, /truncated=\{rolloverBridgesTruncated\}/);
  const rolloverSource = readFileSync(
    resolve(import.meta.dirname, "./_components/money-rollover-panel.tsx"),
    "utf8",
  );
  assert.match(rolloverSource, /name="acceptUnverifiedDaysNote"/);
  assert.match(rolloverSource, /rollover-unverified-count/);
});

test("unavailable reads are explicit and never rendered as confirmed zero", () => {
  assert.match(source, /Money state unavailable/);
  assert.match(source, /recorded cash, safe-to-spend/i);
  assert.match(historySource, /Totals are unavailable right now/);
  assert.match(historySource, /Movement history could not be loaded/);
  assert.match(overviewSource, /Progress unavailable — not shown as zero/);
  assert.match(overviewSource, /Incomplete reading — not shown as zero/);
  assert.match(overviewSource, /Spending summaries unavailable right now/);
});

test("page query offsets succeed through the actual listMovements parser and repository path", async () => {
  let received: unknown;
  const repository = {
    list: async (_actor: unknown, query: unknown) => {
      received = query;
      return { ok: true as const, value: [] };
    },
  } as unknown as MoneyMovementRepository;

  const result = await listMovements(
    createAuthenticatedActor("owner-1"),
    repository,
    { limit: "25", offset: "50", kind: "expense" },
    { timezone: "Africa/Casablanca", now: new Date("2026-11-23T12:00:00.000Z") },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(received, {
    limit: 26,
    offset: 50,
    from: null,
    to: null,
    cutoff: null,
    kind: "expense",
    excludeKind: null,
  });
});
