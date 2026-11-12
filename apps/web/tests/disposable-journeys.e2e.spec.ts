import { readFile } from "node:fs/promises";
import { test, expect, ownerClient } from "./disposable-fixtures";
import { signInPwaOwner, setUnreadNotificationsForOwner } from "./pwa-fixtures";

test("created task persists and owner B cannot read, update or delete it", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/tasks");
  const title = "E2E owner A private task";
  await page.getByTestId("tasks-new-task").click();
  await page.getByLabel("Command", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

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
  const expenses = await a.from("personal_expenses").select("id,amount_minor,occurred_at").is("deleted_at", null);
  expect(expenses.error).toBeNull();
  expect(expenses.data).toHaveLength(1);
  const expense = expenses.data?.[0];
  if (!expense) throw new Error("Expense was not persisted.");
  expect(expense.amount_minor).toBe(1250);
  const visits = await a.from("money_coffee_visits").select("id,visit_key");
  expect(visits.error).toBeNull();
  expect(visits.data).toHaveLength(1);
  const b = await ownerClient(owners.ownerB);
  const seededB = await b.from("personal_expenses").insert({
    owner_user_id: owners.ownerB.id, amount_minor: 9900, currency: "MAD", category: "coffee",
    merchant: "E2E private B expense", need_vs_want: "want", occurred_at: expense.occurred_at,
    idempotency_key: "e2e-export-b", create_fingerprint: "b".repeat(64),
  });
  expect(seededB.error).toBeNull();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(expense.occurred_at));
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
  const emptyLedger = page.getByText("No expenses yet.", { exact: true });
  await expect(emptyLedger).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(emptyLedger).toBeVisible();
  await expect(row).toHaveCount(0);
  const deleted = await a.from("personal_expenses").select("deleted_at").eq("id", expense.id).single();
  expect(deleted.error).toBeNull();
  expect(deleted.data?.deleted_at).toBeTruthy();
});

test("shutdown check-in and routine evidence persist through a reload", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/shutdown");
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
