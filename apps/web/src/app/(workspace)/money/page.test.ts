import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createAuthenticatedActor, listExpenses } from "@ega/application";
import type { ExpenseRepository } from "@ega/application";

const source = readFileSync(resolve(import.meta.dirname, "./page.tsx"), "utf8");

test("money page derives actor from verified user and reads through expense application", () => {
  assert.match(source, /getCurrentUser\(\)/);
  assert.match(source, /createAuthenticatedActor\(user\.id\)/);
  assert.match(source, /listExpenses\(/);
  assert.match(source, /new SupabaseExpenseRepository\(client\)/);
  assert.doesNotMatch(source, /owner_user_id\s*:/);
});

test("money page honors owner timezone and formats stored integer centimes as MAD", () => {
  assert.match(source, /getWebTimeContext\(\)/);
  assert.match(source, /time\.persistedTimezone\s*\?\?\s*MONEY_DEFAULT_TIMEZONE/);
  assert.match(source, /timeZone:\s*timezone/);
  assert.match(source, /expense\.amountMinor\s*\/\s*100/);
  assert.match(source, /currency:\s*"MAD"/);
  assert.doesNotMatch(source, /Africa\/Casablanca/);
});

test("money page composes the shared period state and shows local today separately", () => {
  assert.match(source, /getMoneyState\(/);
  assert.match(source, /SupabaseMoneyPeriodRepository/);
  assert.match(source, /MoneyPeriodPanel/);
  assert.match(source, /localToday=\{moneyState\.localToday\}/);
  assert.match(source, /period=\{moneyState\.period\}/);
  assert.match(source, /legacyReviewRequired=/);
  assert.match(source, /selectedPeriodId/);
  assert.match(source, /Tracking period unavailable/);
});

test("money page reads shared reserves with request-scoped repositories and renders every input", () => {
  assert.match(source, /getCurrentMoneyReserves\(actor/);
  assert.match(source, /new SupabaseMoneyPeriodRepository\(client\)/);
  assert.match(source, /new SupabaseMoneyBudgetRepository\(client\)/);
  // Reserve cash/commitments/funding come from the canonical period and budget
  // repositories. Obligations are used by the separate MONEY-10 template read,
  // never as a reserve calculation input.
  assert.match(
    source,
    /getCurrentMoneyReserves\(actor,\s*\{\s*period: moneyState\.period,\s*periods: new SupabaseMoneyPeriodRepository\(client\),\s*budgets: new SupabaseMoneyBudgetRepository\(client\),\s*\}\)/,
  );
  for (const field of ["recordedCashMinor", "unpaidCommitmentsMinor", "savingsTargetMinor", "fundedSavingsMinor", "unfundedSavingsMinor", "emergencyTargetMinor", "emergencyUsedMinor", "remainingEmergencyMinor", "safeFlexibleMinor"]) {
    assert.match(source, new RegExp(`reserves\\.${field}`));
  }
  assert.match(source, /reserve inputs are incomplete or could not be loaded/);
});

test("money ledger displays need-vs-want and keeps notes visible beside merchants", () => {
  assert.match(source, /Need or want/);
  assert.match(source, /expense\.needVsWant/);
  assert.match(source, /expense\.merchant\s*\?\?\s*"Expense"/);
  assert.match(source, /expense\.note\s*&&/);
  assert.doesNotMatch(source, /expense\.merchant\s*\?\?\s*expense\.note/);
});

test("money page renders recorded cash and the movement ledger through the shared use cases", () => {
  assert.match(source, /getMoneyState\(/);
  assert.match(source, /listMovements\(/);
  // Recorded cash is rendered by the canonical period panel from the shared
  // MONEY-03 cash position, never a second page-local calculation.
  assert.match(source, /cash=\{moneyState\.cash\}/);
  assert.match(source, /getMoneyMovementTotals\(/);
  assert.match(source, /new SupabaseMoneyRepository\(client\)/);
  assert.match(source, /MoneyMovementPanel/);
  assert.match(source, /MoneyMovementActions/);
  assert.doesNotMatch(source, /owner_user_id\s*:/);
});

test("daily reference renders shared values with method and unavailable state", () => {
  assert.match(source, /dayStartBaseline\?\.dailyReference\?\.available/);
  assert.match(source, /Daily reference/);
  assert.match(source, /Daily remaining/);
  assert.match(source, /dailyReference\.algorithm/);
  assert.match(source, /Unavailable — baseline or complete daily expense data is missing/);
  assert.doesNotMatch(source, /dailyRemainingMinor\s*\?\?/);
});

test("money ledger has bounded URL pagination and accessible loading failure recovery", () => {
  assert.match(source, /limit:\s*"25"/);
  assert.match(source, /Math\.min\(parsedOffset,\s*100_000\)/);
  assert.match(source, /offset/);
  assert.match(source, /aria-label="Expense pages"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /Retry/);
  assert.match(source, /No expenses yet/);
});

test("money page exposes complete filtered CSV export and focus refresh", () => {
  assert.match(source, /action="\/money\/export"/);
  assert.match(source, /name="from"/);
  assert.match(source, /name="to"/);
  assert.match(source, /Download CSV/);
  assert.match(source, /never silently cut off/);
  assert.match(source, /RefreshOnFocus/);
});

test("unavailable or truncated spending is never shown as a complete zero", () => {
  assert.match(source, /Progress unavailable — not shown as zero/);
  assert.match(source, /Incomplete reading — not shown as zero/);
  assert.match(source, /summary\.monthToDate\.truncated/);
  assert.match(source, /Spending summaries unavailable right now/);
});

test("page query values succeed through the actual listExpenses parser and repository path", async () => {
  let received: unknown;
  const repository = {
    list: async (_actor: unknown, query: unknown) => {
      received = query;
      return { ok: true as const, value: [] };
    },
  } as unknown as ExpenseRepository;

  const result = await listExpenses(
    createAuthenticatedActor("owner-1"),
    repository,
    { limit: "25", offset: "50" },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(received, {
    limit: 26,
    offset: 50,
    startUtcIso: null,
    endUtcExclusiveIso: null,
    startBookingDate: null,
    endBookingDateExclusive: null,
  });
});

test("money page renders durable day close evidence and restated totals", () => {
  assert.match(source, /MoneyDayClosePanel/);
  assert.match(source, /dayClose=\{moneyState\.dayClose\}/);
  assert.match(source, /lastClose=\{moneyState\.lastClose\}/);
  assert.match(source, /recentCloses=\{moneyState\.recentCloses\}/);
  assert.match(source, /dayClosesUnavailable=\{moneyState\.dayClosesUnavailable\}/);
  assert.match(source, /closeMoneyDayAction/);
});

test("money page previews rollover only for an ended source through shared use cases", () => {
  assert.match(source, /MoneyRolloverPanel/);
  assert.match(source, /moneyState\.period\?\.lifecycle === "ended"/);
  assert.match(source, /getMoneyRolloverPreviewForPeriod\(/);
  assert.match(source, /new SupabaseMoneyRolloverRepository\(client\)/);
  assert.match(source, /new SupabaseObligationRepository\(client\)/);
  assert.match(source, /rolloverMoneyPeriodAction/);
  assert.doesNotMatch(source, /owner_user_id\s*:/);
});

test("daily reference shows the active day's included spending even when it is zero", () => {
  assert.match(source, /Daily included spending/);
  assert.match(source, /dailyReference\.dailyIncludedExpenseMinor/);
  assert.match(source, /Days left in period/);
  assert.match(source, /dailyReference\.daysRemaining/);
});
