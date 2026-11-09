import { expect, test } from "@playwright/test";

import { getPwaOwners, hasPwaAuthCredentials, signInPwaOwner } from "./pwa-fixtures";

test("owner starts the day with 1-2 outcomes and runs a timer", async ({ page }) => {
  test.skip(
    !hasPwaAuthCredentials() || process.env.PO03_DISPOSABLE_ENV !== "1",
    "Requires explicitly authorized disposable environment and test owner",
  );

  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/today");

  await expect(page.getByTestId("morning-startup")).toBeVisible();

  const group = page.locator('[data-testid^="morning-startup-group-"]').first();
  await expect(group).toBeVisible();

  const checkboxes = group.getByRole("checkbox");
  const checkboxCount = await checkboxes.count();
  expect(checkboxCount).toBeGreaterThan(0);

  const selectionCount = Math.min(2, checkboxCount);
  const selectedTitles: string[] = [];
  const selectedIds: string[] = [];

  for (let index = 0; index < selectionCount; index += 1) {
    const checkbox = checkboxes.nth(index);
    selectedIds.push(await checkbox.inputValue());
    const inputId = await checkbox.getAttribute("id");
    expect(inputId).toBeTruthy();
    const label = group.locator(`label[for="${inputId}"]`);
    const labelText = (await label.innerText()).trim();
    selectedTitles.push(labelText.split("·")[0]?.trim() ?? labelText);
    await checkbox.check();
  }

  await group.getByRole("button", { name: /^Start with / }).click();
  const outcomeWord = selectionCount === 1 ? "outcome" : "outcomes";
  await expect(
    page.getByText(
      new RegExp(`Morning startup saved: ${selectionCount} ${outcomeWord} for today\\.`),
    ),
  ).toBeVisible();

  await page.reload();
  const planned = page.getByTestId("morning-startup-planned");
  await expect(planned).toBeVisible();
  for (const title of selectedTitles) {
    await expect(planned.getByText(title, { exact: false })).toBeVisible();
  }

  // A leftover session from another run must not make the start assertion flaky.
  const existingStop = page.getByRole("button", { name: /^Stop timer$/ }).first();
  if (await existingStop.isVisible().catch(() => false)) {
    await existingStop.click();
    await expect(page.getByText("Timer stopped")).toBeVisible();
    await page.getByRole("radio", { name: /No status change/ }).check();
    await page.getByRole("button", { name: "Save outcome" }).click();
  }

  const startTimer = page.locator("form")
    .filter({ has: page.locator('input[name="taskId"]').and(page.locator(`input[value="${selectedIds[0]}"]`)) })
    .getByRole("button", { name: /^Start timer$/ }).first();
  await expect(startTimer).toBeVisible();
  await startTimer.click();

  const stopTimer = page.getByRole("button", { name: /^Stop timer$/ }).first();
  await expect(stopTimer).toBeVisible();
  await stopTimer.click();
  await expect(page.getByText("Timer stopped")).toBeVisible();
});
