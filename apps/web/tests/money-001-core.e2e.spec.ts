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
 *   - verify owner B sees none of owner A's data;
 *   - drive one quick entry + history on a phone-sized viewport.
 */

async function openMoney(page: import("@playwright/test").Page) {
  await page.goto("/money");
  await expect(page.getByRole("heading", { name: "Money", exact: true }).first()).toBeVisible();
}

test("optional close, reviewed finalization and an accurate primary view", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/money");
  await openMoney(page);

  // --- Create a Nov 1-30 period with a known opening and Nov 20 active date.
  const periodPanel = page.locator("#money-period");
  await periodPanel.getByLabel("Start", { exact: true }).fill("2026-11-01");
  await periodPanel.getByLabel("End", { exact: true }).fill("2026-11-30");
  await periodPanel.getByLabel("Active date", { exact: true }).fill("2026-11-20");
  await periodPanel.getByLabel("Opening cash").selectOption("known");
  await periodPanel.getByLabel("Opening (MAD)").fill("1000.00");
  await periodPanel.getByLabel("Cutoff date").fill("2026-11-01");
  await periodPanel.getByRole("button", { name: "Save period", exact: true }).click();
  await expect(
    periodPanel.getByText("2026-11-01–2026-11-30", { exact: false }).first(),
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
  await closePanel.getByRole("button", { name: "Close 2026-11-20", exact: true }).click();
  await expect(closePanel.getByText(/Closed 2026-11-20|Retained close/).first()).toBeVisible();
  // The close's server refresh must land before the settings form is used;
  // otherwise it would submit the pre-close version and correctly conflict.
  await expect(periodPanel.getByLabel("Active date", { exact: true })).toHaveValue(
    "2026-11-21",
  );

  const owner = await ownerClient(owners.ownerA);
  const closeBefore = await owner
    .from("money_day_closes")
    .select("close_date,close_fingerprint,snapshot")
    .eq("period_id", (await owner.from("money_periods").select("id").single()).data?.id ?? "");
  expect(closeBefore.error).toBeNull();
  expect(closeBefore.data).toHaveLength(1);
  expect(closeBefore.data?.[0]?.close_date).toBe("2026-11-20");

  // --- Move the active date to Nov 23 without closing Nov 21/22.
  await periodPanel.getByLabel("Active date", { exact: true }).fill("2026-11-23");
  await periodPanel.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(
    page.getByText("active 2026-11-23", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("21 unverified/unclosed days", { exact: false }).first()).toBeVisible();

  // --- Record the Nov 23 expense through the one quick entry.
  await page.locator("#quick-amount").fill("12.50");
  await page.locator("#quick-booking-date").fill("2026-11-23");
  await page.locator("#quick-category").selectOption("coffee");
  await page.locator("#quick-need").selectOption("want");
  await page.locator("#quick-merchant").fill("E2E Nov 23 coffee");
  await page.getByRole("button", { name: "Record movement", exact: true }).click();
  await expect(page.getByText("Movement recorded.", { exact: false })).toBeVisible();

  const historyRow = page
    .getByTestId(/^money-history-row-/)
    .filter({ hasText: "E2E Nov 23 coffee" });
  await expect(historyRow).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByTestId(/^money-history-row-/).filter({ hasText: "E2E Nov 23 coffee" }),
  ).toHaveCount(1);

  // --- Durable effects: one movement, no fabricated closes, close unchanged.
  const period = await owner.from("money_periods").select("id,lifecycle,active_date").single();
  expect(period.error).toBeNull();
  const periodId = period.data?.id;
  if (!periodId) throw new Error("Period was not created.");
  expect(period.data?.active_date).toBe("2026-11-23");
  expect(period.data?.lifecycle).toBe("tracking");

  const expenseRows = await owner
    .from("personal_expenses")
    .select("id,amount_minor,booking_date,merchant,kind")
    .eq("period_id", periodId)
    .eq("merchant", "E2E Nov 23 coffee")
    .is("deleted_at", null);
  expect(expenseRows.error).toBeNull();
  expect(expenseRows.data).toHaveLength(1);
  expect(expenseRows.data?.[0]?.amount_minor).toBe(1250);
  expect(expenseRows.data?.[0]?.booking_date).toBe("2026-11-23");

  const closes = await owner
    .from("money_day_closes")
    .select("close_date,close_fingerprint,snapshot")
    .eq("period_id", periodId)
    .order("close_date");
  expect(closes.error).toBeNull();
  expect(closes.data).toHaveLength(1);
  expect(closes.data?.[0]?.close_date).toBe("2026-11-20");
  expect(closes.data?.[0]?.close_fingerprint).toBe(closeBefore.data?.[0]?.close_fingerprint);
  expect(JSON.stringify(closes.data?.[0]?.snapshot)).toBe(
    JSON.stringify(closeBefore.data?.[0]?.snapshot),
  );
  for (const date of ["2026-11-21", "2026-11-22", "2026-11-23"]) {
    expect(closes.data?.some((row) => row.close_date === date)).toBe(false);
  }

  // --- Independent oracle: opening + posted movements through the cutoff.
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
    .lte("booking_date", "2026-11-23");
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
    "2026-11-23",
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
  await expect(rolloverPanel.getByTestId("rollover-unverified-count")).toContainText(
    "29 reviewed · acknowledgment required",
  );
  await rolloverPanel.getByRole("button", { name: "Roll over to 2026-12-01", exact: true }).click();
  await expect(rolloverPanel.getByRole("alert")).toContainText(
    "Acknowledge the 29 reviewed unverified",
  );
  const noReceipt = await owner
    .from("money_period_rollovers")
    .select("id")
    .eq("source_period_id", periodId);
  expect(noReceipt.error).toBeNull();
  expect(noReceipt.data).toEqual([]);

  await rolloverPanel
    .getByLabel("Acknowledge unverified/unclosed days (retained as provenance)")
    .fill("Reviewed Nov 1-19 and 21-30 as unverified; no close rows invented");
  await rolloverPanel
    .getByLabel("Accept closing, restatement or savings differences (retained as provenance)")
    .fill("Savings target versus transfers reviewed");
  const rolloverButton = rolloverPanel.getByRole("button", {
    name: "Roll over to 2026-12-01",
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
  expect(receipt?.unverified_days_count).toBe(29);
  expect(receipt?.unverified_days_note).toContain("Reviewed Nov 1-19");
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
  expect(successor?.start_date).toBe("2026-12-01");
  expect(successor?.end_date).toBe("2026-12-31");

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
  await expect(page.getByText("E2E Nov 23 coffee", { exact: false })).toHaveCount(0);
  await expect(page.getByText("2026-11-01–2026-11-30", { exact: false })).toHaveCount(0);
  const bPeriods = await (await ownerClient(owners.ownerB)).from("money_periods").select("id");
  expect(bPeriods.error).toBeNull();
  expect(bPeriods.data).toEqual([]);
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
