import { test, expect, ownerClient } from "./disposable-fixtures";
import { signInPwaOwner } from "./pwa-fixtures";

/**
 * MONEY-001-A browser acceptance.
 *
 * Runs against the disposable backend with isolated owners. It exercises the
 * real Next.js page, server actions and owner-scoped persistence:
 *   - close Nov 20, leave Nov 21/22 unclosed, move the active date and record a
 *     Nov 23 expense through the unified quick entry;
 *   - prove exactly one movement, one retained close and no fabricated closes;
 *   - compare displayed recorded/safe values with an independent ledger sum;
 *   - finalize the still-tracking period only after acknowledging the exact
 *     unverified dates; assert one successor opening/link and no fake closes;
 *   - continue the calendar with a later routine entry, keep a forgotten
 *     superseded-range expense in its own period, initialize the missing
 *     predecessor opening through the owner form, then adopt that successor
 *     explicitly without fabricating a close or opening before review;
 *   - verify owner B sees none of owner A's data;
 *   - drive one quick entry + history on a phone-sized viewport.
 */

async function openMoney(page: import("@playwright/test").Page) {
  await page.goto("/money");
  await expect(page.getByRole("heading", { name: "Money", exact: true }).first()).toBeVisible();
}

const MONEY_TIMEZONE = "Africa/Casablanca";

/** Owner-local civil date, matching the fixture's stored IANA timezone. */
function localIsoDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MONEY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftIsoDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function clampToPeriod(date: string, startDate: string, endDate: string): string {
  return date < startDate ? startDate : date > endDate ? endDate : date;
}

function endOfMonthIso(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
}

/**
 * Independent wall-time conversion oracle. It uses Intl with the Money period
 * timezone, so it shares no code with the application helper under test.
 */
function zonedWallTimeToUtcIso(
  date: string,
  time: string,
  timeZone: string,
): string {
  const naive = Date.parse(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(naive));
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)!.value);
  const zonedAsUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  );
  return new Date(naive - (zonedAsUtc - naive)).toISOString();
}

test("optional close, reviewed finalization and an accurate primary view", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/money");
  await openMoney(page);

  // Every date is derived from the owner-local today so the journey stays valid
  // across months and years. The period is a 21-day window ending yesterday so
  // finalization is no longer early; its successor starts today.
  const today = localIsoDate();
  const entryDate = shiftIsoDate(today, -1);
  const periodStart = shiftIsoDate(today, -21);
  const periodEnd = entryDate;
  const periodDayCount = 21;
  const cursor = shiftIsoDate(today, -5);
  const successorStart = shiftIsoDate(periodEnd, 1);
  const successorEnd = shiftIsoDate(successorStart, periodDayCount - 1);
  // Unverified days before the final day exclude the one retained close.
  const unverifiedBeforeToday = 20 - 1;

  // --- Create a period with a known opening and an earlier active date.
  const periodPanel = page.locator("#money-period");
  await periodPanel.getByLabel("Start", { exact: true }).fill(periodStart);
  await periodPanel.getByLabel("End", { exact: true }).fill(periodEnd);
  await periodPanel.getByLabel("Active date", { exact: true }).fill(cursor);
  await periodPanel.getByLabel("Opening cash").selectOption("known");
  await periodPanel.getByLabel("Opening (MAD)").fill("1000.00");
  await periodPanel.getByLabel("Cutoff date").fill(periodStart);
  await periodPanel.getByRole("button", { name: "Save period", exact: true }).click();
  await expect(
    periodPanel.getByText(`${periodStart}–${periodEnd}`, { exact: false }).first(),
  ).toBeVisible();

  // Complete the explicit day-start baseline, then set known protections.
  await periodPanel.getByRole("button", { name: "Complete day-start setup", exact: true }).click();
  await expect(periodPanel.getByRole("button", { name: "Rebase day-start baseline to current state", exact: true })).toBeVisible();

  const budgetPanel = page.locator("#money-budget");
  await budgetPanel.getByLabel("Savings target").fill("100.00");
  await budgetPanel.getByLabel("Emergency target").fill("50.00");
  await budgetPanel.getByRole("button", { name: /period plan/i }).click();
  await expect(budgetPanel.getByText(/plan saved|saved/i).first()).toBeVisible();
  // Rebase after setting the protections so the close evidence and live
  // reserve projection describe the same policy state.
  await periodPanel.getByRole("button", { name: "Rebase day-start baseline to current state", exact: true }).click();

  const closePanel = page.locator("#money-close");
  await expect(closePanel.getByText("Day close is optional", { exact: false })).toBeVisible();
  await closePanel.getByRole("button", { name: `Close ${cursor}`, exact: true }).click();
  await expect(closePanel.getByText(new RegExp(`Closed ${cursor}|Retained close`)).first()).toBeVisible();
  // The close's server refresh must land before the settings form is used;
  // otherwise it would submit the pre-close version and correctly conflict.
  await expect(periodPanel.getByLabel("Active date", { exact: true })).toHaveValue(
    shiftIsoDate(cursor, 1),
  );

  const owner = await ownerClient(owners.ownerA);
  const closeBefore = await owner
    .from("money_day_closes")
    .select("close_date,close_fingerprint,snapshot")
    .eq("period_id", (await owner.from("money_periods").select("id").single()).data?.id ?? "");
  expect(closeBefore.error).toBeNull();
  expect(closeBefore.data).toHaveLength(1);
  expect(closeBefore.data?.[0]?.close_date).toBe(cursor);

  // --- Move the active date to the final day without closing the skipped days.
  await periodPanel.getByLabel("Active date", { exact: true }).fill(entryDate);
  await periodPanel.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(
    page.getByText(`active ${entryDate}`, { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(`${unverifiedBeforeToday} unverified/unclosed days`, { exact: false }).first(),
  ).toBeVisible();

  // --- Record the final-day expense through the one quick entry.
  await page.locator("#quick-amount").fill("12.50");
  await page.locator("#quick-booking-date").fill(entryDate);
  await page.locator("#quick-category").selectOption("coffee");
  await page.locator("#quick-need").selectOption("want");
  await page.locator("#quick-merchant").fill("E2E final-day coffee");
  await page.getByRole("button", { name: "Record movement", exact: true }).click();
  await expect(page.getByText("Movement recorded.", { exact: false })).toBeVisible();

  const historyRow = page
    .getByTestId(/^money-history-row-/)
    .filter({ hasText: "E2E final-day coffee" });
  await expect(historyRow).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByTestId(/^money-history-row-/).filter({ hasText: "E2E final-day coffee" }),
  ).toHaveCount(1);

  // --- Durable effects: one movement, no fabricated closes, close unchanged.
  const period = await owner.from("money_periods").select("id,lifecycle,active_date").single();
  expect(period.error).toBeNull();
  const periodId = period.data?.id;
  if (!periodId) throw new Error("Period was not created.");
  expect(period.data?.active_date).toBe(entryDate);
  expect(period.data?.lifecycle).toBe("tracking");

  const expenseRows = await owner
    .from("personal_expenses")
    .select("id,amount_minor,booking_date,merchant,kind")
    .eq("period_id", periodId)
    .eq("merchant", "E2E final-day coffee")
    .is("deleted_at", null);
  expect(expenseRows.error).toBeNull();
  expect(expenseRows.data).toHaveLength(1);
  expect(expenseRows.data?.[0]?.amount_minor).toBe(1250);
  expect(expenseRows.data?.[0]?.booking_date).toBe(entryDate);

  const closes = await owner
    .from("money_day_closes")
    .select("close_date,close_fingerprint,snapshot")
    .eq("period_id", periodId)
    .order("close_date");
  expect(closes.error).toBeNull();
  expect(closes.data).toHaveLength(1);
  expect(closes.data?.[0]?.close_date).toBe(cursor);
  expect(closes.data?.[0]?.close_fingerprint).toBe(closeBefore.data?.[0]?.close_fingerprint);
  expect(JSON.stringify(closes.data?.[0]?.snapshot)).toBe(
    JSON.stringify(closeBefore.data?.[0]?.snapshot),
  );
  for (const date of [shiftIsoDate(cursor, 1), shiftIsoDate(cursor, 2), entryDate]) {
    expect(closes.data?.some((row) => row.close_date === date)).toBe(false);
  }

  // --- Independent oracle: opening + posted movements through the effective
  // current cutoff. The active cursor is the final day, and the ordinary current
  // view clamps owner-local today to the period end.
  const currentCutoff = clampToPeriod(today, periodStart, periodEnd);
  const opening = await owner
    .from("personal_expenses")
    .select("amount_minor")
    .eq("period_id", periodId)
    .eq("kind", "opening")
    .is("deleted_at", null)
    .single();
  expect(opening.error).toBeNull();
  const posted = await owner
    .from("personal_expenses")
    .select("direction,amount_minor,kind")
    .eq("period_id", periodId)
    .neq("kind", "opening")
    .is("deleted_at", null)
    .lte("booking_date", currentCutoff);
  expect(posted.error).toBeNull();
  const recordedCashMinor =
    (opening.data?.amount_minor ?? 0) +
    (posted.data ?? []).reduce(
      (total, row) =>
        total + (row.direction === "in" ? row.amount_minor : -row.amount_minor),
      0,
    );
  expect(recordedCashMinor).toBe(98_750);

  await expect(page.getByTestId("money-recorded-cash")).toHaveAttribute(
    "data-minor",
    String(recordedCashMinor),
  );
  await expect(page.getByTestId("money-recorded-cash")).toHaveAttribute(
    "data-cutoff",
    currentCutoff,
  );
  // No unpaid obligations and monthly caps are unrelated. The independent
  // safe amount is recorded cash minus the unfunded savings and emergency
  // protections set through the budget panel.
  const safeMinor = recordedCashMinor - 10_000 - 5_000;
  await expect(page.getByTestId("money-safe-to-spend")).toHaveAttribute(
    "data-minor",
    String(safeMinor),
  );
  await expect(page.getByTestId("money-daily-reference")).toBeVisible();
  await expect(page.getByTestId("money-daily-reference")).toHaveAttribute(
    "data-date",
    currentCutoff,
  );
  await expect(page.getByTestId("money-daily-remaining")).toBeVisible();

  // Every advanced capability stays reachable from the secondary navigation.
  for (const [linkName, headingName] of [
    ["Savings & emergency", "Savings and emergency protection"],
    ["Budget & caps", "Budget and advisory caps"],
    ["Export", "Export"],
    ["Period setup", "Period setup and settings"],
    ["Day close", "Optional day close"],
    ["Finalize & audit", "Finalize, roll over and audit"],
  ] as const) {
    await page.getByRole("link", { name: linkName, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: headingName, exact: true }).first(),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("link", { name: "Bills & recurring", exact: true }).first(),
  ).toHaveAttribute("href", "/money/recurring");

  // --- Finalization: missing acknowledgment is refused, then retained.
  const rolloverPanel = page.locator("#money-rollover");
  const unverifiedCount = periodDayCount - 1;
  await expect(rolloverPanel.getByTestId("rollover-unverified-count")).toContainText(
    `${unverifiedCount} reviewed · acknowledgment required`,
  );
  await rolloverPanel.getByRole("button", { name: `Roll over to ${successorStart}`, exact: true }).click();
  await expect(rolloverPanel.getByRole("alert")).toContainText(
    `Acknowledge the ${unverifiedCount} reviewed unverified`,
  );
  const noReceipt = await owner
    .from("money_period_rollovers")
    .select("id")
    .eq("source_period_id", periodId);
  expect(noReceipt.error).toBeNull();
  expect(noReceipt.data).toEqual([]);

  await rolloverPanel
    .getByLabel("Acknowledge unverified/unclosed days (retained as provenance)")
    .fill("Reviewed every unverified day; no close rows invented");
  await rolloverPanel
    .getByLabel("Accept closing, restatement or savings differences (retained as provenance)")
    .fill("Savings target versus transfers reviewed");
  const rolloverButton = rolloverPanel.getByRole("button", {
    name: `Roll over to ${successorStart}`,
    exact: true,
  });
  await expect(rolloverButton).toBeEnabled();
  await rolloverButton.click();
  await expect(page.getByText("Period history", { exact: false })).toBeVisible();

  await expect.poll(async () => {
    const result = await owner
      .from("money_period_rollovers")
      .select("id")
      .eq("source_period_id", periodId);
    expect(result.error).toBeNull();
    return result.data?.length ?? 0;
  }).toBe(1);
  const receipts = await owner
    .from("money_period_rollovers")
    .select(
      "source_period_id,successor_period_id,unverified_days_count,unverified_days_note,opening_amount_minor",
    )
    .eq("source_period_id", periodId);
  expect(receipts.error).toBeNull();
  expect(receipts.data).toHaveLength(1);
  const receipt = receipts.data?.[0];
  expect(receipt?.unverified_days_count).toBe(unverifiedCount);
  expect(receipt?.unverified_days_note).toContain("Reviewed every unverified day");
  expect(receipt?.opening_amount_minor).toBe(98_750);

  const periods = await owner
    .from("money_periods")
    .select("id,lifecycle,successor_period_id,start_date,end_date")
    .order("start_date");
  expect(periods.error).toBeNull();
  expect(periods.data).toHaveLength(2);
  const source = periods.data?.find((row) => row.id === periodId);
  const successor = periods.data?.find((row) => row.id === receipt?.successor_period_id);
  expect(source?.lifecycle).toBe("rolled_over");
  expect(source?.successor_period_id).toBe(successor?.id);
  expect(successor?.lifecycle).toBe("tracking");
  expect(successor?.start_date).toBe(successorStart);
  expect(successor?.end_date).toBe(successorEnd);

  const successorOpening = await owner
    .from("personal_expenses")
    .select("id,amount_minor,kind")
    .eq("period_id", successor?.id ?? "")
    .eq("kind", "opening")
    .is("deleted_at", null);
  expect(successorOpening.error).toBeNull();
  expect(successorOpening.data).toHaveLength(1);
  expect(successorOpening.data?.[0]?.amount_minor).toBe(98_750);

  const sourceClosesAfter = await owner
    .from("money_day_closes")
    .select("close_date")
    .eq("period_id", periodId);
  expect(sourceClosesAfter.error).toBeNull();
  expect(sourceClosesAfter.data).toHaveLength(1);

  const sourceExpenses = await owner
    .from("personal_expenses")
    .select("id,merchant,kind")
    .eq("period_id", periodId)
    .is("deleted_at", null)
    .neq("kind", "opening");
  expect(sourceExpenses.error).toBeNull();
  expect(sourceExpenses.data).toHaveLength(1);

  // The successor starts today, so finalizing yesterday's period does not lock
  // the owner out of recording the current local day.
  await page.locator("#quick-amount").fill("3.00");
  await page.locator("#quick-booking-date").fill(today);
  await page.locator("#quick-category").selectOption("coffee");
  await page.locator("#quick-need").selectOption("want");
  await page.locator("#quick-merchant").fill("E2E post-finalization today");
  await page.getByRole("button", { name: "Record movement", exact: true }).click();
  await expect(page.getByText("Movement recorded.", { exact: false })).toBeVisible();
  await expect.poll(async () => {
    const result = await owner
      .from("personal_expenses")
      .select("period_id")
      .eq("merchant", "E2E post-finalization today")
      .is("deleted_at", null);
    expect(result.error).toBeNull();
    return result.data?.[0]?.period_id ?? null;
  }).toBe(successor?.id);

  // Period-scoped history has an explicit all-history escape hatch for
  // pre-period and gap movements, without losing the selected-period view.
  await page.getByRole("link", { name: "Show all history", exact: true }).first().click();
  await expect(
    page.getByText("History covers all recorded movements", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Show this period", exact: true }).first().click();

  // --- Owner B sees none of owner A's data.
  await page.context().clearCookies();
  await signInPwaOwner(page, owners.ownerB, "/money");
  await openMoney(page);
  await expect(page.getByText("E2E final-day coffee", { exact: false })).toHaveCount(0);
  await expect(page.getByText(`${periodStart}–${periodEnd}`, { exact: false })).toHaveCount(0);
  const bPeriods = await (await ownerClient(owners.ownerB)).from("money_periods").select("id");
  expect(bPeriods.error).toBeNull();
  expect(bPeriods.data).toEqual([]);
});

test("continuity keeps the superseded range writable and adopts it explicitly", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/money");
  await openMoney(page);

  const today = localIsoDate();
  const sourceStart = shiftIsoDate(today, -30);
  const sourceEnd = shiftIsoDate(today, -3);
  const successorStart = shiftIsoDate(sourceEnd, 1);
  const successorEnd = endOfMonthIso(today);
  const backfillDate = shiftIsoDate(today, -10);

  // Create a period that already ended before today with the default unknown
  // opening. Finalization must be able to initialize that missing opening
  // later, after automatic continuation has superseded the range.
  const periodPanel = page.locator("#money-period");
  await periodPanel.getByLabel("Start", { exact: true }).fill(sourceStart);
  await periodPanel.getByLabel("End", { exact: true }).fill(sourceEnd);
  await periodPanel.getByLabel("Active date", { exact: true }).fill(sourceEnd);
  await periodPanel.getByLabel("Opening cash").selectOption("unknown");
  await periodPanel.getByRole("button", { name: "Save period", exact: true }).click();
  await expect(
    periodPanel.getByText(`${sourceStart}–${sourceEnd}`, { exact: false }).first(),
  ).toBeVisible();
  await periodPanel
    .getByRole("button", { name: "Complete day-start setup", exact: true })
    .click();

  const owner = await ownerClient(owners.ownerA);
  const sourceRow = await owner
    .from("money_periods")
    .select("id,version")
    .eq("start_date", sourceStart)
    .single();
  expect(sourceRow.error).toBeNull();
  const sourceId = sourceRow.data?.id;
  if (!sourceId) throw new Error("Source period was not created.");

  // A routine write today is after the source window. The atomic database
  // path supersedes the source and inserts the movement into exactly one
  // tracking successor; reads never perform this mutation.
  await page.locator("#quick-amount").fill("20.00");
  await page.locator("#quick-booking-date").fill(today);
  await page.locator("#quick-category").selectOption("coffee");
  await page.locator("#quick-need").selectOption("want");
  await page.locator("#quick-merchant").fill("E2E continuation coffee");
  await page.getByRole("button", { name: "Record movement", exact: true }).click();
  await expect(page.getByText("Movement recorded.", { exact: false })).toBeVisible();

  await expect.poll(async () => {
    const result = await owner
      .from("money_periods")
      .select("id,lifecycle,successor_period_id,finalization_reference,start_date,end_date")
      .order("start_date");
    expect(result.error).toBeNull();
    return result.data?.length ?? 0;
  }).toBe(2);

  const periods = await owner
    .from("money_periods")
    .select("id,lifecycle,successor_period_id,finalization_reference,start_date,end_date")
    .order("start_date");
  expect(periods.error).toBeNull();
  const source = periods.data?.find((row) => row.id === sourceId);
  const successor = periods.data?.find((row) => row.id !== sourceId);
  expect(source?.lifecycle).toBe("superseded");
  expect(source?.successor_period_id).toBeNull();
  expect(source?.finalization_reference).toBeNull();
  expect(successor?.lifecycle).toBe("tracking");
  expect(successor?.start_date).toBe(successorStart);
  expect(successor?.end_date).toBe(successorEnd);
  const sourceCloses = await owner
    .from("money_day_closes")
    .select("id")
    .eq("period_id", sourceId);
  expect(sourceCloses.data).toEqual([]);
  const successorOpeningBefore = await owner
    .from("personal_expenses")
    .select("id")
    .eq("period_id", successor?.id ?? "")
    .eq("kind", "opening");
  expect(successorOpeningBefore.data).toEqual([]);

  const continuedMovement = await owner
    .from("personal_expenses")
    .select("period_id,booking_date,merchant")
    .eq("merchant", "E2E continuation coffee")
    .is("deleted_at", null);
  expect(continuedMovement.error).toBeNull();
  expect(continuedMovement.data?.[0]?.period_id).toBe(successor?.id);
  expect(continuedMovement.data?.[0]?.booking_date).toBe(today);

  // A forgotten date inside the superseded range is still routine entry for
  // that period's own dates; it is not silently moved into the successor.
  await page.getByRole("button", { name: "Record another", exact: true }).click();
  await page.locator("#quick-amount").fill("7.00");
  await page.locator("#quick-booking-date").fill(backfillDate);
  await page.locator("#quick-category").selectOption("household");
  await page.locator("#quick-need").selectOption("need");
  await page.locator("#quick-merchant").fill("E2E superseded backfill");
  await page.getByRole("button", { name: "Record movement", exact: true }).click();
  await expect(page.getByText("Movement recorded.", { exact: false })).toBeVisible();

  const backfill = await owner
    .from("personal_expenses")
    .select("period_id,booking_date,merchant")
    .eq("merchant", "E2E superseded backfill")
    .is("deleted_at", null);
  expect(backfill.error).toBeNull();
  expect(backfill.data?.[0]?.period_id).toBe(sourceId);
  expect(backfill.data?.[0]?.booking_date).toBe(backfillDate);

  // Finalizing the source adopts the exact continued period. The source still
  // has no opening, so the owner initializes exactly that missing evidence
  // first; active dates and settings stay closed.
  await page.goto(`/money?periodId=${encodeURIComponent(sourceId)}`);
  await openMoney(page);
  const periodPanelAfterContinuation = page.locator("#money-period");
  await expect(
    periodPanelAfterContinuation.getByText("Initialize the historical opening", {
      exact: true,
    }),
  ).toBeVisible();
  await periodPanelAfterContinuation.getByLabel("Opening (MAD)").fill("1000.00");
  await periodPanelAfterContinuation
    .getByRole("button", { name: "Save opening", exact: true })
    .click();
  await expect
    .poll(async () => {
      const result = await owner
        .from("money_periods")
        .select("initialization,opening_movement_id,lifecycle")
        .eq("id", sourceId)
        .single();
      return result.data?.initialization ?? null;
    })
    .toBe("initialized");
  const sourceInitialized = await owner
    .from("money_periods")
    .select("lifecycle,opening_movement_id")
    .eq("id", sourceId)
    .single();
  expect(sourceInitialized.data?.lifecycle).toBe("superseded");
  expect(sourceInitialized.data?.opening_movement_id).not.toBeNull();

  const rolloverPanel = page.locator("#money-rollover");
  await expect(
    rolloverPanel.getByText(/calendar already continued into the period/),
  ).toBeVisible();
  await rolloverPanel
    .getByLabel("Acknowledge unverified/unclosed days (retained as provenance)")
    .fill("Reviewed every unverified day; the continued period stays untouched");
  const rolloverButton = rolloverPanel.getByRole("button", {
    name: `Roll over to ${successorStart}`,
    exact: true,
  });
  await expect(rolloverButton).toBeEnabled();
  await rolloverButton.click();

  await expect.poll(async () => {
    const result = await owner
      .from("money_period_rollovers")
      .select("id")
      .eq("source_period_id", sourceId);
    expect(result.error).toBeNull();
    return result.data?.length ?? 0;
  }).toBe(1);

  const receipt = await owner
    .from("money_period_rollovers")
    .select("successor_period_id,opening_amount_minor")
    .eq("source_period_id", sourceId)
    .single();
  expect(receipt.error).toBeNull();
  expect(receipt.data?.successor_period_id).toBe(successor?.id);
  expect(receipt.data?.opening_amount_minor).toBe(99_300);

  const sourceAfter = await owner
    .from("money_periods")
    .select("lifecycle,successor_period_id,finalization_reference")
    .eq("id", sourceId)
    .single();
  expect(sourceAfter.data?.lifecycle).toBe("rolled_over");
  expect(sourceAfter.data?.successor_period_id).toBe(successor?.id);
  expect(sourceAfter.data?.finalization_reference).not.toBeNull();

  const successorOpening = await owner
    .from("personal_expenses")
    .select("amount_minor")
    .eq("period_id", successor?.id ?? "")
    .eq("kind", "opening")
    .is("deleted_at", null);
  expect(successorOpening.error).toBeNull();
  expect(successorOpening.data).toHaveLength(1);
  expect(successorOpening.data?.[0]?.amount_minor).toBe(99_300);
  const successorMovements = await owner
    .from("personal_expenses")
    .select("merchant")
    .eq("period_id", successor?.id ?? "")
    .neq("kind", "opening")
    .is("deleted_at", null);
  expect(successorMovements.data).toHaveLength(1);
  expect(successorMovements.data?.[0]?.merchant).toBe("E2E continuation coffee");
  const sourceMovements = await owner
    .from("personal_expenses")
    .select("merchant")
    .eq("period_id", sourceId)
    .neq("kind", "opening")
    .is("deleted_at", null);
  expect(sourceMovements.data).toHaveLength(1);
  expect(sourceMovements.data?.[0]?.merchant).toBe("E2E superseded backfill");
});

test("today's expense appears in the current projection without moving the active cursor", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/money");
  await openMoney(page);

  const today = localIsoDate();
  const cursor = shiftIsoDate(today, -2);
  const periodStart = shiftIsoDate(today, -10);
  const periodEnd = shiftIsoDate(today, 10);

  // A current tracking period containing owner-local today, with an earlier
  // unclosed active cursor. The cursor is never advanced in this journey.
  const periodPanel = page.locator("#money-period");
  await periodPanel.getByLabel("Start", { exact: true }).fill(periodStart);
  await periodPanel.getByLabel("End", { exact: true }).fill(periodEnd);
  await periodPanel.getByLabel("Active date", { exact: true }).fill(cursor);
  await periodPanel.getByLabel("Opening cash").selectOption("known");
  await periodPanel.getByLabel("Opening (MAD)").fill("1000.00");
  await periodPanel.getByLabel("Cutoff date").fill(periodStart);
  await periodPanel.getByRole("button", { name: "Save period", exact: true }).click();
  await expect(
    page.getByText("active " + cursor, { exact: false }).first(),
  ).toBeVisible();

  // Complete the explicit initial setup, but deliberately do not create or
  // rebase a day-start baseline for today: today's guidance must be derived
  // read-only from the prior-day ledger and the current plan.
  await periodPanel.getByRole("button", { name: "Complete day-start setup", exact: true }).click();
  await expect(periodPanel.getByRole("button", { name: "Rebase day-start baseline to current state", exact: true })).toBeVisible();

  const budgetPanel = page.locator("#money-budget");
  await budgetPanel.getByLabel("Savings target").fill("100.00");
  await budgetPanel.getByLabel("Emergency target").fill("50.00");
  await budgetPanel.getByRole("button", { name: /period plan/i }).click();
  await expect(budgetPanel.getByText(/plan saved|saved/i).first()).toBeVisible();

  // The quick entry default booking date is owner-local today, and recording
  // it must not depend on closing the skipped cursor days.
  await expect(page.locator("#quick-booking-date")).toHaveValue(today);
  await page.locator("#quick-amount").fill("50.00");
  await page.locator("#quick-category").selectOption("coffee");
  await page.locator("#quick-need").selectOption("want");
  await page.locator("#quick-merchant").fill("E2E final-day coffee");
  await page.getByRole("button", { name: "Record movement", exact: true }).click();
  await expect(page.getByText("Movement recorded.", { exact: false })).toBeVisible();

  await page.reload();
  await expect(
    page.getByTestId(/^money-history-row-/).filter({ hasText: "E2E final-day coffee" }),
  ).toHaveCount(1);
  await expect(page.getByText("active " + cursor, { exact: false }).first()).toBeVisible();

  const owner = await ownerClient(owners.ownerA);
  const period = await owner
    .from("money_periods")
    .select("id,lifecycle,active_date")
    .single();
  expect(period.error).toBeNull();
  const periodId = period.data?.id;
  if (!periodId) throw new Error("Period was not created.");
  expect(period.data?.active_date).toBe(cursor);
  expect(period.data?.lifecycle).toBe("tracking");

  const movement = await owner
    .from("personal_expenses")
    .select("id,amount_minor,booking_date,merchant,kind")
    .eq("period_id", periodId)
    .eq("merchant", "E2E final-day coffee")
    .is("deleted_at", null);
  expect(movement.error).toBeNull();
  expect(movement.data).toHaveLength(1);
  expect(movement.data?.[0]?.amount_minor).toBe(5_000);
  expect(movement.data?.[0]?.booking_date).toBe(today);
  expect(movement.data?.[0]?.kind).toBe("expense");

  // Optional close was never invoked, and the read-only derivation created no
  // baseline for today.
  const closes = await owner
    .from("money_day_closes")
    .select("close_date")
    .eq("period_id", periodId);
  expect(closes.error).toBeNull();
  expect(closes.data).toEqual([]);
  const baselines = await owner
    .from("money_day_start_baselines")
    .select("date")
    .eq("period_id", periodId)
    .eq("date", today);
  expect(baselines.error).toBeNull();
  expect(baselines.data).toEqual([]);

  // Independent oracle from the durable rows and canonical integer-centime
  // rules: opening 100,000 - today's 5,000 expense, then the unfunded savings
  // target (10,000) and remaining emergency protection (5,000).
  const opening = await owner
    .from("personal_expenses")
    .select("amount_minor")
    .eq("period_id", periodId)
    .eq("kind", "opening")
    .is("deleted_at", null)
    .single();
  expect(opening.error).toBeNull();
  const posted = await owner
    .from("personal_expenses")
    .select("direction,amount_minor")
    .eq("period_id", periodId)
    .neq("kind", "opening")
    .is("deleted_at", null)
    .lte("booking_date", today);
  expect(posted.error).toBeNull();
  const recordedCashMinor =
    (opening.data?.amount_minor ?? 0) +
    (posted.data ?? []).reduce(
      (total, row) =>
        total + (row.direction === "in" ? row.amount_minor : -row.amount_minor),
      0,
    );
  const expectedSafeMinor = recordedCashMinor - 10_000 - 5_000;
  const daysRemaining =
    Math.floor(
      (Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  const expectedReferenceMinor = Math.floor(
    (expectedSafeMinor + 5_000) / daysRemaining,
  );

  expect(recordedCashMinor).toBe(95_000);
  expect(expectedSafeMinor).toBe(80_000);
  await expect(page.getByTestId("money-recorded-cash")).toHaveAttribute(
    "data-minor",
    String(recordedCashMinor),
  );
  await expect(page.getByTestId("money-recorded-cash")).toHaveAttribute(
    "data-cutoff",
    today,
  );
  await expect(page.getByTestId("money-safe-to-spend")).toHaveAttribute(
    "data-minor",
    String(expectedSafeMinor),
  );
  await expect(page.getByTestId("money-daily-reference")).toHaveAttribute(
    "data-date",
    today,
  );
  await expect(page.getByTestId("money-daily-reference")).toHaveAttribute(
    "data-basis",
    "derived_start_of_day",
  );
  await expect(page.getByTestId("money-daily-reference")).toHaveAttribute(
    "data-minor",
    String(expectedReferenceMinor),
  );
  await expect(page.getByTestId("money-daily-remaining")).toHaveAttribute(
    "data-minor",
    String(expectedReferenceMinor - 5_000),
  );
});

test.describe("owner timezone wall-time entry", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("a datetime-local entry stores the instant in the verified owner timezone", async ({ page, owners }) => {
    await signInPwaOwner(page, owners.ownerA, "/money");
    await openMoney(page);

    const today = localIsoDate();
    const periodStart = shiftIsoDate(today, -10);
    const periodEnd = shiftIsoDate(today, 10);

    // The period is explicitly Africa/Casablanca; the browser runs in
    // America/Los_Angeles. A browser-local interpretation would store a
    // different instant, so the expected UTC instant is computed independently
    // through Intl with the period timezone (including its DST rules).
    const periodPanel = page.locator("#money-period");
    await periodPanel.getByLabel("Start", { exact: true }).fill(periodStart);
    await periodPanel.getByLabel("End", { exact: true }).fill(periodEnd);
    await periodPanel.getByLabel("Active date", { exact: true }).fill(periodStart);
    await periodPanel.getByLabel("Opening cash").selectOption("known");
    await periodPanel.getByLabel("Opening (MAD)").fill("1000.00");
    await periodPanel.getByLabel("Cutoff date").fill(periodStart);
    await periodPanel.getByRole("button", { name: "Save period", exact: true }).click();
    await expect(
      periodPanel.getByText(`${periodStart}–${periodEnd}`, { exact: false }).first(),
    ).toBeVisible();

    const wallTime = `${today}T00:30`;
    const expectedOccurredAt = zonedWallTimeToUtcIso(
      today,
      "00:30",
      MONEY_TIMEZONE,
    );

    await page.locator("#quick-booking-date").fill(today);
    await page.locator("#quick-amount").fill("10.00");
    await page.locator("#quick-category").selectOption("coffee");
    await page.locator("#quick-need").selectOption("want");
    await page.locator("#quick-merchant").fill("E2E midnight coffee");
    await page.getByText("More options", { exact: true }).click();
    await page.locator("#quick-time").fill(wallTime);
    await page.getByRole("button", { name: "Record movement", exact: true }).click();
    await expect(page.getByText("Movement recorded.", { exact: false })).toBeVisible();

    const owner = await ownerClient(owners.ownerA);
    const row = await owner
      .from("personal_expenses")
      .select("occurred_at,booking_date,amount_minor")
      .eq("merchant", "E2E midnight coffee")
      .is("deleted_at", null)
      .single();
    expect(row.error).toBeNull();
    expect(new Date(row.data!.occurred_at).toISOString()).toBe(expectedOccurredAt);
    expect(row.data?.booking_date).toBe(today);
    expect(row.data?.amount_minor).toBe(1_000);
  });
});

test("one quick entry and one history remain usable on a phone-sized viewport", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/money");
  await page.setViewportSize({ width: 390, height: 844 });
  await openMoney(page);

  // Accessible validation failure before a real write. Scope to the form so the
  // Next.js route announcer is not mistaken for the form error.
  const quickForm = page.getByRole("form", { name: "Quick financial entry" });
  await page.locator("#quick-amount").fill("not-money");
  await page.getByRole("button", { name: "Record movement", exact: true }).click();
  await expect(quickForm.getByRole("alert")).toContainText(/amount/i);
  await expect(quickForm.getByRole("alert")).toBeFocused();

  for (const [kind, amount, merchant] of [
    ["income", "20.00", "E2E mobile income"],
    ["savings_transfer", "5.00", "E2E mobile savings"],
  ] as const) {
    await page.locator("#quick-kind").selectOption(kind);
    await page.locator("#quick-amount").fill(amount);
    await page.locator("#quick-merchant").fill(merchant);
    await page.getByRole("button", { name: "Record movement", exact: true }).click();
    await expect(page.getByText("Movement recorded.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Record another", exact: true }).click();
  }

  const history = page.locator('[aria-labelledby="money-history-heading"]');
  await expect(history.getByText("Movement history", { exact: true })).toBeVisible();
  await expect(history.getByText("E2E mobile income", { exact: false })).toHaveCount(1);
  await expect(history.getByText("E2E mobile savings", { exact: false })).toHaveCount(1);
  await expect(history.getByText("income", { exact: true })).toHaveCount(1);
  await expect(history.getByText("savings transfer", { exact: true })).toHaveCount(1);

  // The history's table wrapper is horizontally scrollable instead of clipping
  // the mobile layout.
  const scroller = history.locator("div.overflow-x-auto");
  await expect(scroller).toHaveCount(1);

  // One quick entry control, not two parallel creation forms.
  await expect(page.locator("#quick-amount")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Add expense", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Record income or savings movement", exact: true })).toHaveCount(0);

  const owner = await ownerClient(owners.ownerA);
  const rows = await owner
    .from("personal_expenses")
    .select("merchant,kind")
    .is("deleted_at", null)
    .in("merchant", ["E2E mobile income", "E2E mobile savings"]);
  expect(rows.error).toBeNull();
  expect(rows.data).toHaveLength(2);
});
