import { expect, test } from "@playwright/test";
import { getPwaOwners, hasPwaAuthCredentials, signInPwaOwner } from "./pwa-fixtures";

function skipUnlessDisposableEnvironment() {
  test.skip(
    !hasPwaAuthCredentials() || process.env.PO02_DISPOSABLE_ENV !== "1",
    "Requires explicitly authorized disposable environment and test owner",
  );
}

/** Monday work value currently persisted, read from the rendered form. */
async function mondayWorkValue(page: import("@playwright/test").Page): Promise<string> {
  return page
    .getByRole("group", { name: "monday" })
    .getByLabel("Work minutes")
    .inputValue();
}

test("owner edits, reloads and pauses a personal schedule", async ({ page }) => {
  skipUnlessDisposableEnvironment();
  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/settings/preferences");
  await expect(page.getByRole("heading", { name: "Personal schedule" })).toBeVisible();

  // Day boundaries come from the account Time Context, not the browser clock.
  await expect(page.getByText(/Account time zone:/)).toBeVisible();
  await expect(
    page.getByText(/Today in .+: \w+ — \d+ min work, \d+ min job search/),
  ).toBeVisible();
  await expect(page.getByText(/48 h work \/ 7 h 30 min job search/)).toBeVisible();
  await expect(page.getByText(/2880 work, 450 job search/)).toBeVisible();

  const monday = page.getByRole("group", { name: "monday" });
  const saturday = page.getByRole("group", { name: "saturday" });
  await monday.getByLabel("Work minutes").fill("450");
  await saturday.getByLabel("Work minutes").fill("210");
  await page.getByRole("group", { name: "Startup" }).getByLabel("Start").fill("05:45");
  await page.getByRole("button", { name: "Save personal schedule" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Personal schedule saved" })).toBeVisible();
  await page.reload();
  await expect(monday.getByLabel("Work minutes")).toHaveValue("450");
  await expect(saturday.getByLabel("Work minutes")).toHaveValue("210");
  await expect(page.getByRole("group", { name: "Startup" }).getByLabel("Start")).toHaveValue("05:45");
  await page.goto("/settings/appearance");
  await page.getByRole("radio", { name: /Dark/ }).check();
  await page.getByRole("button", { name: "Save appearance" }).click();
  await page.goto("/settings/preferences");
  await expect(monday.getByLabel("Work minutes")).toHaveValue("450");
  await monday.getByLabel("Work minutes").fill("1500");
  await page.getByRole("button", { name: "Save personal schedule" }).click();
  expect(await monday.getByLabel("Work minutes").evaluate((element: HTMLInputElement) => element.validity.rangeOverflow)).toBe(true);
  await page.reload();
  await expect(monday.getByLabel("Work minutes")).toHaveValue("450");
  await page.context().clearCookies();
  await signInPwaOwner(page, ownerA, "/settings/preferences");
  await expect(monday.getByLabel("Work minutes")).toHaveValue("450");
  await page.getByLabel("Pause schedule").check();
  await page.getByRole("button", { name: "Save personal schedule" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Personal schedule saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Pause schedule")).toBeChecked();
  await expect(monday.getByLabel("Work minutes")).toHaveValue("450");
  await page.getByLabel("Pause schedule").uncheck();
  await page.getByRole("button", { name: "Save personal schedule" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Personal schedule saved" })).toBeVisible();
  await monday.getByLabel("Work minutes").fill("480");
  await saturday.getByLabel("Work minutes").fill("240");
  await page.getByRole("group", { name: "Startup" }).getByLabel("Start").fill("06:00");
  await page.getByRole("button", { name: "Save personal schedule" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Personal schedule saved" })).toBeVisible();
});

test("server validation rejects an enabled overlap without saving the draft", async ({ page }) => {
  skipUnlessDisposableEnvironment();
  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/settings/preferences");

  const monday = page.getByRole("group", { name: "monday" });
  const chess = page.getByRole("group", { name: "Chess" });
  const originalMonday = await mondayWorkValue(page);
  const editedMonday = String(Math.min(1440, Number(originalMonday) + 30));

  // Chess is a disabled block by default; enabling it on Monday at 06:15
  // overlaps the enabled Startup block (06:00-06:30).
  await chess.getByLabel("mon", { exact: true }).check();
  await chess.getByLabel("Start", { exact: true }).fill("06:15");
  await chess.getByLabel("End", { exact: true }).fill("06:45");
  await chess.getByLabel("Enabled").check();
  await monday.getByLabel("Work minutes").fill(editedMonday);

  await page.getByRole("button", { name: "Save personal schedule" }).click();
  await expect(page.getByRole("alert")).toContainText(/cannot overlap/i);

  // The rejected draft stays in the form so the owner can fix it.
  await expect(monday.getByLabel("Work minutes")).toHaveValue(editedMonday);
  await expect(chess.getByLabel("Enabled")).toBeChecked();

  // Reload proves nothing was persisted.
  await page.reload();
  await expect(monday.getByLabel("Work minutes")).toHaveValue(originalMonday);
  await expect(chess.getByLabel("Enabled")).not.toBeChecked();
  await expect(chess.getByLabel("mon", { exact: true })).not.toBeChecked();
});

test("reduced motion and keyboard-only editing still saves", async ({ page }) => {
  skipUnlessDisposableEnvironment();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/settings/preferences");

  const monday = page.getByRole("group", { name: "monday" });
  const originalMonday = await mondayWorkValue(page);
  const editedMonday = String(Number(originalMonday) === 480 ? 510 : 480);

  const pause = page.getByLabel("Pause schedule");
  await pause.focus();
  await page.keyboard.press("Space");
  await expect(pause).toBeChecked();

  const work = monday.getByLabel("Work minutes");
  await work.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(editedMonday);

  const save = page.getByRole("button", { name: "Save personal schedule" });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Personal schedule saved" })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Pause schedule")).toBeChecked();
  await expect(monday.getByLabel("Work minutes")).toHaveValue(editedMonday);

  // Restore the fixture owner to an active schedule with the original target.
  await page.getByLabel("Pause schedule").focus();
  await page.keyboard.press("Space");
  await monday.getByLabel("Work minutes").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(originalMonday);
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Personal schedule saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Pause schedule")).not.toBeChecked();
  await expect(monday.getByLabel("Work minutes")).toHaveValue(originalMonday);
});
