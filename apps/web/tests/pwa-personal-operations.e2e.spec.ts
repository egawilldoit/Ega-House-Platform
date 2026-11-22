import { expect, test } from "./disposable-fixtures";

import { getPwaOwners, signInPwaOwner } from "./pwa-fixtures";

test("owner edits daily work targets and the theme from tabbed Settings", async ({ page }) => {
  test.setTimeout(180_000);
  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/settings?tab=preferences");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Preferences", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Integrations", exact: true })).toBeVisible();

  const workTargets = page.locator('form[aria-label="Work targets"]');
  await expect(workTargets).toBeVisible();
  await expect(page.getByText("48h", { exact: true })).toBeVisible();
  await expect(page.getByText("7.5h", { exact: true })).toBeVisible();

  const monday = page.getByLabel("Monday work target in hours");
  const saturday = page.getByLabel("Saturday work target in hours");
  await monday.fill("7.5");
  await saturday.fill("3.5");
  await page.getByLabel("Pause targets").check();
  await page.getByRole("button", { name: "Save work targets" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Work targets saved." }),
  ).toBeVisible();

  await page.reload();
  await expect(monday).toHaveValue("7.5");
  await expect(saturday).toHaveValue("3.5");
  await expect(page.getByLabel("Pause targets")).toBeChecked();

  const appearance = page.locator('form[aria-label="Appearance settings"]');
  await appearance.getByText("Dark", { exact: true }).click();
  await expect(page.locator('input[name="theme"][value="dark"]')).toBeChecked();
  await page.getByRole("button", { name: "Save appearance" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Appearance preferences saved." }),
  ).toBeVisible();

  await page.reload();
  await expect(page.locator('input[name="theme"][value="dark"]')).toBeChecked();

  // Restore the seeded defaults so the disposable fixture stays reusable.
  await monday.fill("8");
  await saturday.fill("4");
  await page.getByLabel("Pause targets").uncheck();
  await page.getByRole("button", { name: "Save work targets" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Work targets saved." }),
  ).toBeVisible();
});

test("invalid target hours are rejected before any write", async ({ page }) => {
  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/settings?tab=preferences");
  const monday = page.getByLabel("Monday work target in hours");
  const original = await monday.inputValue();
  await monday.fill("25");
  // Native constraint validation blocks the submit before the server sees it.
  expect(await monday.evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(false);
  await page.reload();
  await expect(monday).toHaveValue(original);
});
