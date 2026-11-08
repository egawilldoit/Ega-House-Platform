import { expect, test } from "@playwright/test";

import { getPwaOwners, hasPwaAuthCredentials, signInPwaOwner } from "./pwa-fixtures";

test("owner edits, reloads and pauses a personal schedule through the redesigned UI", async ({ page }) => {
  test.skip(!hasPwaAuthCredentials() || process.env.PO02_DISPOSABLE_ENV !== "1", "Requires explicitly authorized disposable environment and test owner");
  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/settings/preferences");

  const scheduleForm = page.locator('form[aria-label="Personal schedule"]');
  await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
  await expect(scheduleForm).toBeVisible();
  await expect(page.getByText(/Account time zone:/)).toBeVisible();
  await expect(page.getByText(/Today in .+: \w+ — \d+ min work, \d+ min job search/)).toBeVisible();
  await expect(page.getByText("2,880 minutes per week")).toBeVisible();
  await expect(page.getByText("450 minutes per week")).toBeVisible();

  const monday = page.getByLabel("Monday work minutes");
  const saturday = page.getByLabel("Saturday work minutes");
  const saveSchedule = page.getByRole("button", { name: "Save changes" });

  await monday.fill("450");
  await saturday.fill("210");
  await page.getByRole("button", { name: "Startup", exact: true }).click();
  await page.locator("#guidance-0-start").fill("05:45");
  await saveSchedule.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Personal schedule saved." }),
  ).toBeVisible();

  await page.reload();
  await expect(monday).toHaveValue("450");
  await expect(saturday).toHaveValue("210");
  await page.getByRole("button", { name: "Startup", exact: true }).click();
  await expect(page.locator("#guidance-0-start")).toHaveValue("05:45");
  await expect(page.getByText("47h", { exact: true })).toBeVisible();
  await expect(page.getByText("2,820 minutes per week")).toBeVisible();

  await page.goto("/settings/appearance");
  await page.getByText("Dark", { exact: true }).click();
  await expect(page.locator('input[name="theme"][value="dark"]')).toBeChecked();
  await page.getByRole("button", { name: "Save appearance" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Appearance preferences saved." }),
  ).toBeVisible();

  await page.goto("/settings/preferences");
  await expect(monday).toHaveValue("450");

  await monday.fill("1500");
  await expect(monday).toHaveAttribute("aria-invalid", "true");
  await expect(saveSchedule).toBeDisabled();
  await page.reload();
  await expect(monday).toHaveValue("450");

  await page.context().clearCookies();
  await signInPwaOwner(page, ownerA, "/settings/preferences");
  await expect(monday).toHaveValue("450");

  const activeSwitch = page.getByLabel("Schedule active");
  await activeSwitch.uncheck();
  await saveSchedule.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Personal schedule saved." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Schedule active")).not.toBeChecked();
  await expect(
    page
      .getByRole("region", { name: "Schedule summary" })
      .getByText("Paused", { exact: true }),
  ).toBeVisible();
  await expect(monday).toHaveValue("450");

  await page.getByLabel("Schedule active").check();
  await saveSchedule.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Personal schedule saved." }),
  ).toBeVisible();

  await monday.fill("480");
  await saturday.fill("240");
  await page.getByRole("button", { name: "Startup", exact: true }).click();
  await page.locator("#guidance-0-start").fill("06:00");
  await saveSchedule.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Personal schedule saved." }),
  ).toBeVisible();
});

test("dirty schedule survives browser Back/Forward and clears after Discard", async ({ page }) => {
  test.skip(!hasPwaAuthCredentials() || process.env.PO02_DISPOSABLE_ENV !== "1", "Requires explicitly authorized disposable environment and test owner");
  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/settings/appearance");
  await page.getByRole("link", { name: "Preferences", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/preferences$/);

  const monday = page.getByLabel("Monday work minutes");
  const saveBar = page.getByRole("region", { name: "Schedule save status" });
  await monday.fill("450");
  await expect(saveBar).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/appearance$/);

  await page.goForward();
  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await expect(monday).toHaveValue("450");
  await expect(saveBar.getByText(/Unsaved changes restored/)).toBeVisible();

  await saveBar.getByRole("button", { name: "Discard" }).click();
  await expect(monday).toHaveValue("480");
  await expect(saveBar).toBeHidden();

  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await expect(monday).toHaveValue("480");
  await expect(page.getByText(/Unsaved changes restored/)).toHaveCount(0);
});

test("confirmed anchor leave discards the draft and reaches the destination once", async ({ page }) => {
  test.skip(!hasPwaAuthCredentials() || process.env.PO02_DISPOSABLE_ENV !== "1", "Requires explicitly authorized disposable environment and test owner");
  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/settings/appearance");
  await page.getByRole("link", { name: "Preferences", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/preferences$/);

  const monday = page.getByLabel("Monday work minutes");
  await monday.fill("450");
  let dialogs = 0;
  page.once("dialog", async (dialog) => {
    dialogs += 1;
    await dialog.accept();
  });

  await page.getByRole("link", { name: "Appearance", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  expect(dialogs).toBe(1);

  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await expect(monday).toHaveValue("480");
  await expect(page.getByText(/Unsaved changes restored/)).toHaveCount(0);
});


test("server rejects overlapping guidance without persisting the edited target", async ({ page }) => {
  test.skip(!hasPwaAuthCredentials() || process.env.PO02_DISPOSABLE_ENV !== "1", "Requires explicitly authorized disposable environment and test owner");
  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/settings/preferences");
  const monday = page.getByLabel("Monday work minutes");
  const original = await monday.inputValue();
  const edited = original === "1440" ? "1410" : String(Number(original) + 30);
  await monday.fill(edited);
  // Tamper with the submitted payload to exercise the server boundary despite
  // the redesigned editor preventing invalid submissions in normal use.
  await page.locator('input[name="schedule"]').evaluate((element: HTMLInputElement) => {
    const schedule = JSON.parse(element.value);
    schedule.guidance[1] = { ...schedule.guidance[1], enabled: true, days: ["monday"], start: "06:15", end: "06:45" };
    element.value = JSON.stringify(schedule);
  });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(/overlap/i);
  await expect(monday).toHaveValue(edited);
  await page.reload();
  await expect(monday).toHaveValue(original);
});

test("reduced motion and keyboard editing save and restore the schedule", async ({ page }) => {
  test.skip(!hasPwaAuthCredentials() || process.env.PO02_DISPOSABLE_ENV !== "1", "Requires explicitly authorized disposable environment and test owner");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const { ownerA } = getPwaOwners();
  await signInPwaOwner(page, ownerA, "/settings/preferences");
  const monday = page.getByLabel("Monday work minutes");
  const original = await monday.inputValue();
  const edited = original === "480" ? "510" : "480";
  const active = page.getByLabel("Schedule active");
  await active.focus();
  await page.keyboard.press("Space");
  await expect(active).not.toBeChecked();
  await monday.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(edited);
  await page.getByRole("button", { name: "Save changes" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Personal schedule saved." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Schedule active")).not.toBeChecked();
  await expect(monday).toHaveValue(edited);
  await page.getByLabel("Schedule active").focus();
  await page.keyboard.press("Space");
  await monday.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(original);
  await page.getByRole("button", { name: "Save changes" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Personal schedule saved." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Schedule active")).toBeChecked();
  await expect(monday).toHaveValue(original);
});
