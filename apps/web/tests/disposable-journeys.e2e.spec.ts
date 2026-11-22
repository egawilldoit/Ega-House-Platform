import { readFile } from "node:fs/promises";
import { test, expect, ownerClient } from "./disposable-fixtures";
import { signInPwaOwner, setUnreadNotificationsForOwner } from "./pwa-fixtures";

test("created task persists and owner B cannot read, update or delete it", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/tasks");
  const title = "E2E owner A private task";
  await page.getByTestId("tasks-new-task").click();
  const createDialog = page.getByRole("dialog", { name: "Create", exact: true });
  await createDialog.getByLabel("Task title", { exact: true }).fill(title);
  await createDialog.getByRole("button", { name: "Create task", exact: true }).click();
  // Creation revalidates /tasks, so the list can briefly render a duplicate row
  // while the router refresh settles. Assert exactly one canonical task link:
  // this retries through that transient state yet still fails if the task is
  // rendered twice once the workbench is stable.
  const createdTaskLink = page.getByRole("link", {
    name: `Open ${title} details`,
    exact: true,
  });
  await expect(createdTaskLink).toHaveCount(1);
  await page.reload();
  await expect(createdTaskLink).toHaveCount(1);

  const a = await ownerClient(owners.ownerA);
  const b = await ownerClient(owners.ownerB);
  const own = await a.from("tasks").select("id,title,status").eq("title", title).single();
  expect(own.error).toBeNull();
  if (!own.data) throw new Error("Created task is missing under its ordinary owner session.");
  const id = own.data.id;
  const read = await b.from("tasks").select("id").eq("id", id);
  expect(read.error).toBeNull();
  expect(read.data).toEqual([]);
  const update = await b.from("tasks").update({ title: "B changed A" }).eq("id", id).select("id");
  expect(update.error).toBeNull();
  expect(update.data).toEqual([]);
  const remove = await b.from("tasks").delete().eq("id", id).select("id");
  expect(remove.error).toBeNull();
  expect(remove.data).toEqual([]);
  const unchanged = await a.from("tasks").select("id,title,status").eq("id", id).single();
  expect(unchanged.error).toBeNull();
  expect(unchanged.data).toEqual(own.data);
  await page.context().clearCookies();
  await signInPwaOwner(page, owners.ownerB, "/tasks");
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});

test("Money survives reload, exports only the owner, then edits and deletes", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/today");
  // Keep the purchase timestamp stable across a lost-response retry at a minute boundary.
  await page.clock.setFixedTime(new Date());
  await page.getByRole("button", { name: "Quick expense", exact: true }).click();
  const quick = page.getByRole("dialog", { name: "Quick expense", exact: true });
  await quick.getByLabel("Amount (MAD)", { exact: true }).fill("12.50");
  await quick.getByRole("button", { name: "coffee", exact: true }).click();
  await quick.getByLabel("Merchant (optional)").fill("E2E owner A coffee");
  let committedResponseLost = false;
  await page.route("**/today", async route => {
    if (!committedResponseLost && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      const response = await route.fetch({ maxRedirects: 0 });
      expect(response.ok()).toBe(true);
      committedResponseLost = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await quick.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(quick.getByRole("alert")).toContainText("Your entries are still here");
  expect(committedResponseLost).toBe(true);
  await quick.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(quick.getByRole("status")).toContainText("Expense saved");
  await quick.getByRole("button", { name: "Close quick expense" }).click();
  await page.goto("/money");
  await page.reload();
  const row = page.getByRole("row").filter({ hasText: "E2E owner A coffee" });
  await expect(row).toHaveCount(1);
  // MONEY-05 controls must be reachable from the expense table, not only in the
  // non-expense movement ledger. Counting is metadata on the same row.
  const countVisit = row.getByRole("button", { name: "Count visit", exact: true });
  await expect(countVisit).toBeVisible();
  await countVisit.click();
  await expect(row.getByRole("status")).toContainText("Saved.");
  const a = await ownerClient(owners.ownerA);
  const expenses = await a.from("personal_expenses").select("id,amount_minor,occurred_at,booking_date").is("deleted_at", null);
  expect(expenses.error).toBeNull();
  expect(expenses.data).toHaveLength(1);
  const expense = expenses.data?.[0];
  if (!expense) throw new Error("Expense was not persisted.");
  expect(expense.amount_minor).toBe(1250);
  const visits = await a.from("money_coffee_visits").select("id,visit_key");
  expect(visits.error).toBeNull();
  expect(visits.data).toHaveLength(1);
  const visitLines = await a
    .from("money_coffee_visit_lines")
    .select("expense_id")
    .eq("expense_id", expense.id);
  expect(visitLines.error).toBeNull();
  expect(visitLines.data).toEqual([{ expense_id: expense.id }]);
  const b = await ownerClient(owners.ownerB);
  const seededB = await b.from("personal_expenses").insert({
    owner_user_id: owners.ownerB.id, amount_minor: 9900, currency: "MAD", category: "coffee",
    merchant: "E2E private B expense", need_vs_want: "want", occurred_at: expense.occurred_at,
    idempotency_key: "e2e-export-b", create_fingerprint: "b".repeat(64),
  }).select("booking_date").single();
  expect(seededB.error).toBeNull();
  const day = expense.booking_date;
  expect(seededB.data?.booking_date).toBe(day);
  const downloadPromise = page.waitForEvent("download");
  await page.evaluate(href => {
    const link = document.createElement("a"); link.href = href; link.download = "expenses.csv"; document.body.append(link); link.click(); link.remove();
  }, `/money/export?from=${day}&to=${day}`);
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error("CSV download is missing.");
  const csv = await readFile(path, "utf8");
  expect(csv).toContain("amount_minor,amount_mad");
  expect(csv).toContain("1250,12.50");
  expect(csv).toContain("E2E owner A coffee");
  expect(csv).not.toContain("E2E private B expense");

  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit expense", exact: true });
  await edit.getByLabel("Amount (MAD)", { exact: true }).fill("15.75");
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(edit).toBeHidden();
  await page.reload();
  const updated = await a.from("personal_expenses").select("amount_minor").eq("id", expense.id).single();
  expect(updated.error).toBeNull();
  expect(updated.data?.amount_minor).toBe(1575);
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete expense", exact: true }).getByRole("button", { name: "Confirm delete E2E owner A coffee", exact: true }).click();
  await expect.poll(async () => {
    const deleted = await a.from("personal_expenses").select("deleted_at").eq("id", expense.id).single();
    expect(deleted.error).toBeNull();
    return deleted.data?.deleted_at;
  }).toBeTruthy();
  // The Money page refreshes itself on focus. A reload can briefly leave two
  // server-rendered copies of the ledger in the DOM, so scope to the visible
  // expense section and wait for one settled match before asserting.
  const emptyLedger = page
    .locator('section[aria-labelledby="money-expenses-heading"]')
    .getByText("No expenses yet.", { exact: true })
    .filter({ visible: true });
  await expect.poll(() => emptyLedger.count()).toBe(1);
  await expect(emptyLedger).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect.poll(() => emptyLedger.count()).toBe(1);
  await expect(emptyLedger).toBeVisible();
  await expect(row).toHaveCount(0);
  const deleted = await a.from("personal_expenses").select("deleted_at").eq("id", expense.id).single();
  expect(deleted.error).toBeNull();
  expect(deleted.data?.deleted_at).toBeTruthy();
});

test("shutdown check-in and routine evidence persist through a reload", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/today");
  // /shutdown is retired; the check-in form now lives in Today's Finish day surface.
  await page.goto("/today?finishDay=1#finish-day");
  await page.getByLabel("What closed out today?").fill("E2E shipped a verified outcome");
  await page.getByLabel("Personal time (minutes, optional)").fill("45");
  await page.getByLabel("Run (minutes)", { exact: true }).fill("25");
  await page.getByRole("checkbox", { name: "Run completed", exact: true }).check();
  await page.getByRole("button", { name: "Save check-in", exact: true }).click();
  await expect(page.getByText("Check-in saved for your day.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("What closed out today?")).toHaveValue("E2E shipped a verified outcome");
  await expect(page.getByLabel("Run (minutes)", { exact: true })).toHaveValue("25");
  await expect(page.getByRole("checkbox", { name: "Run completed", exact: true })).toBeChecked();
  const a = await ownerClient(owners.ownerA);
  const stored = await a.from("daily_checkins").select("outcomes,routine");
  expect(stored.error).toBeNull();
  expect(stored.data).toHaveLength(1);
  expect(stored.data?.[0].outcomes).toBe("E2E shipped a verified outcome");
  expect(stored.data?.[0].routine).toMatchObject({ runMinutes: 25, runCompleted: true });
  await page.goto("/review");
  await expect(page.getByRole("region", { name: "Routine evidence" })).toContainText(/Runs 1\/\d+ \(25m recorded\)/);
});

test("notification read state and channel preference survive reload", async ({ page, owners }) => {
  await setUnreadNotificationsForOwner(owners.ownerA, 1);
  await signInPwaOwner(page, owners.ownerA, "/notifications");
  await expect(page.getByText("E2E PWA baseline reminder", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select all notifications on this page" }).check();
  await page.getByRole("button", { name: "Mark selected read", exact: true }).click();
  await expect(page.getByText("Notification marked read.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(page.getByText("E2E PWA baseline reminder", { exact: true })).toHaveCount(0);
  const preference = page.locator("form").filter({ has: page.locator('input[name="notificationType"][value="task_reminder"]') });
  await preference.getByRole("checkbox", { name: "Email", exact: true }).uncheck();
  await preference.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Notification preferences saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(preference.getByRole("checkbox", { name: "Email", exact: true })).not.toBeChecked();
  const a = await ownerClient(owners.ownerA);
  const notification = await a.from("notifications").select("read_at").eq("title", "E2E PWA baseline reminder").single();
  expect(notification.error).toBeNull();
  expect(notification.data?.read_at).toBeTruthy();
});

test("Money rollover resets selected period choices and retains savings acceptance", async ({ page, owners }) => {
  const { default: postgres } = await import("postgres");
  const { readLocalEnvironment } = await import("../../../scripts/e2e/local-env.cjs");
  const env = readLocalEnvironment();
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const periods: string[] = [];
  try {
    const marker = await sql`SELECT id FROM e2e_private.run`;
    expect(marker).toHaveLength(1);
    expect(marker[0].id).toBe(env.E2E_RUN_ID);
    for (const [index, date] of ["2026-11-01", "2026-11-10"].entries()) {
      const period = await sql.begin(async tx => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT set_config('request.jwt.claim.sub', ${owners.ownerA.id}, true)`;
        await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: owners.ownerA.id, role: "authenticated", aud: "authenticated" })}, true)`;
        return tx`SELECT (p).id AS id FROM (SELECT public.money_create_period(
          ${date}::date, ${date}::date, 'Africa/Casablanca', ${date}::date,
          'initialized', 68900, ${date}::date, ${"a".repeat(64)},
          ${sql.json({ opening: { source: "user_entered", recordedAt: "2026-11-01T00:00:00.000Z", cutoffDate: date, evidence: null, note: null, corrections: [] } })},
          ${sql.json({ savingsTargetMinor: 12000, emergencyTargetMinor: 3000 })}, now()) AS p) created`;
      });
      const id: string = period[0].id;
      periods.push(id);
      await sql`UPDATE public.money_day_start_baselines SET policy_version_id = (SELECT id FROM public.money_policy_versions WHERE owner_user_id = ${owners.ownerA.id} AND period_id = ${id} ORDER BY version DESC LIMIT 1), availability = 'available', unavailable_reason = NULL, cash_minor = 68900, commitments_minor = 0, savings_target_minor = 12000, savings_funded_minor = 0, emergency_target_minor = 3000, emergency_used_minor = 0, inputs = '{"setupComplete":true}'::jsonb WHERE owner_user_id = ${owners.ownerA.id} AND period_id = ${id} AND date = ${date}::date`;
      await sql`UPDATE public.money_periods SET day_start_setup_completed = true, version = version + 1, updated_at = now() WHERE id = ${id} AND owner_user_id = ${owners.ownerA.id}`;
      await sql.begin(async tx => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT set_config('request.jwt.claim.sub', ${owners.ownerA.id}, true)`;
        await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: owners.ownerA.id, role: "authenticated", aud: "authenticated" })}, true)`;
        await tx`SELECT public.money_close_day(${id}::uuid, (SELECT version FROM public.money_periods WHERE id = ${id}), ${date}::date, 'CLOSED', ${`750e8400-e29b-41d4-a716-44665544001${index}`}::uuid, ${String(index + 1).repeat(64)}, ARRAY[]::uuid[], '2026-11-30T20:00:00Z'::timestamptz)`;
      });
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  await signInPwaOwner(page, owners.ownerA, `/money?periodId=${periods[0]}`);
  const start = page.getByLabel("Successor start date (required)");
  await expect(start).toHaveValue("2026-11-02");
  await start.fill("2026-11-05");
  await page.getByLabel("New savings target (MAD)").fill("999");
  await page.getByRole("link", { name: "2026-11-10–2026-11-10" }).click();
  await expect(start).toHaveValue("2026-11-11");
  await expect(page.getByLabel("New savings target (MAD)")).toHaveValue("");
  await start.fill("2026-11-12");
  await page.getByLabel("Successor end date (required)").fill("2026-11-30");
  await page.getByLabel("New savings target (MAD)").fill("25");
  await page.getByLabel("New emergency target (MAD)").fill("12.50");
  const note = page.getByLabel("Accept closing, restatement or savings differences (retained as provenance)");
  const submit = page.getByRole("button", { name: "Roll over to 2026-11-12" });
  const owner = await ownerClient(owners.ownerA);
  await note.fill("Savings shortfall reviewed");
  await submit.click();
  await expect(page.getByRole("form", { name: "Period rollover" }).getByRole("alert")).toHaveText("1 day between 2026-11-10 and 2026-11-12 would belong to no period. Start on 2026-11-11 or explicitly allow the uncovered days.");
  const afterGap = await owner.from("money_period_rollovers").select("id").eq("source_period_id", periods[1]);
  expect(afterGap.error).toBeNull();
  expect(afterGap.data).toEqual([]);
  await expect(note).toHaveValue("Savings shortfall reviewed");
  await expect(page.getByLabel("New savings target (MAD)")).toHaveValue("25");
  await expect(page.getByLabel("New emergency target (MAD)")).toHaveValue("12.50");
  const allowGap = page.getByLabel("Allow untracked days between the finished period and the successor");
  await allowGap.check();
  await note.clear();
  await submit.click();
  await expect(page.getByRole("form", { name: "Period rollover" }).getByRole("alert")).toContainText("Resolve or explicitly accept the savings target difference before rollover.");
  const afterSavings = await owner.from("money_period_rollovers").select("id").eq("source_period_id", periods[1]);
  expect(afterSavings.error).toBeNull();
  expect(afterSavings.data).toEqual([]);
  await expect(allowGap).toBeChecked();
  await expect(page.getByLabel("New savings target (MAD)")).toHaveValue("25");
  await expect(page.getByLabel("New emergency target (MAD)")).toHaveValue("12.50");
  await note.fill("Savings shortfall reviewed");
  await page.getByRole("button", { name: "Roll over to 2026-11-12" }).click();
  await expect.poll(async () => {
    const result = await owner.from("money_period_rollovers").select("successor_period_id,reconciliation_accepted_note").eq("source_period_id", periods[1]).maybeSingle();
    return result.data;
  }).toMatchObject({ reconciliation_accepted_note: "Savings shortfall reviewed" });
  const receipt = await owner.from("money_period_rollovers").select("successor_period_id,reconciliation_accepted_note").eq("source_period_id", periods[1]).single();
  expect(receipt.error).toBeNull();
  if (!receipt.data) throw new Error("Rollover receipt was not persisted.");
  const successor = await owner.from("money_periods").select("start_date,end_date,settings").eq("id", receipt.data.successor_period_id).single();
  expect(successor.error).toBeNull();
  expect(successor.data).toMatchObject({ start_date: "2026-11-12", end_date: "2026-11-30", settings: { savingsTargetMinor: 2500, emergencyTargetMinor: 1250 } });
  await page.reload();
  const persisted = await owner.from("money_period_rollovers").select("reconciliation_accepted_note").eq("source_period_id", periods[1]).single();
  expect(persisted.data).toEqual({ reconciliation_accepted_note: "Savings shortfall reviewed" });
});
