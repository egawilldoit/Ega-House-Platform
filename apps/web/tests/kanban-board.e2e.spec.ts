import { expect, test } from "@playwright/test";

import { hasPwaAuthCredentials, signInPwaOwner, getPwaOwners } from "./pwa-fixtures";

/**
 * EGA-785 board acceptance.
 *
 * These need an authenticated owner (`E2E_AUTH_EMAIL` / `E2E_AUTH_PASSWORD`)
 * because the board is a protected route and the mutation is owner-scoped.
 * Without credentials the test skips explicitly instead of reporting a green
 * login redirect as proof.
 */
test.describe("kanban drag and manual order", () => {
  test.skip(
    !hasPwaAuthCredentials(),
    "Requires E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD for an authenticated owner.",
  );

  test("drag To Do → In Progress persists after reload at desktop and phone", async ({
    page,
  }, testInfo) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ] as const) {
      await page.setViewportSize(viewport);
      const { ownerA } = getPwaOwners();
      await signInPwaOwner(
        page,
        ownerA,
        "/tasks?layout=kanban&boardOrder=manual&view=active",
      );

      const title = `EGA-785 drag ${viewport.width} ${Date.now()}`;
      await page.getByTestId("tasks-new-task").click();
      await page.getByLabel("Command").fill(title);
      await page.getByLabel("Status").selectOption("todo");
      await page.getByRole("button", { name: /Create task/i }).click();
      await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });

      const todoColumn = page.getByTestId("kanban-column-todo");
      const card = todoColumn.getByText(title).locator("xpath=ancestor::article[1]");
      const handle = card.getByRole("button", { name: /^Drag / });
      const target = page.getByTestId("kanban-column-end-in_progress");

      const source = await handle.boundingBox();
      const destination = await target.boundingBox();
      expect(source).not.toBeNull();
      expect(destination).not.toBeNull();
      if (!source || !destination) return;

      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(source.x + source.width / 2 + 12, source.y + 12, { steps: 4 });
      await page.mouse.move(
        destination.x + destination.width / 2,
        destination.y + destination.height / 2,
        { steps: 16 },
      );
      await page.mouse.up();

      await expect(
        page.getByTestId("kanban-column-in_progress").getByText(title),
      ).toBeVisible({ timeout: 15_000 });

      await page.reload();
      await expect(
        page.getByTestId("kanban-column-in_progress").getByText(title),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByTestId("kanban-column-todo").getByText(title),
      ).toHaveCount(0);

      await testInfo.attach(`kanban-drag-${viewport.width}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  });

  test("keyboard ordering with the drag handle persists", async ({ page }) => {
    const { ownerA } = getPwaOwners();
    await signInPwaOwner(page, ownerA, "/tasks?layout=kanban&boardOrder=manual&view=active");

    const stamp = Date.now();
    const first = `EGA-785 keyboard A ${stamp}`;
    const second = `EGA-785 keyboard B ${stamp}`;
    for (const title of [first, second]) {
      await page.getByTestId("tasks-new-task").click();
      await page.getByLabel("Command").fill(title);
      await page.getByLabel("Status").selectOption("todo");
      await page.getByRole("button", { name: /Create task/i }).click();
      await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
    }

    const todoColumn = page.getByTestId("kanban-column-todo");
    const firstCard = todoColumn.getByText(first).locator("xpath=ancestor::article[1]");
    const secondCard = todoColumn.getByText(second).locator("xpath=ancestor::article[1]");
    const initialFirstBox = await firstCard.boundingBox();
    const initialSecondBox = await secondCard.boundingBox();
    expect(initialFirstBox).not.toBeNull();
    expect(initialSecondBox).not.toBeNull();
    if (!initialFirstBox || !initialSecondBox) return;

    const handle = firstCard.getByRole("button", { name: /^Drag / });
    await handle.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press(initialFirstBox.y < initialSecondBox.y ? "ArrowDown" : "ArrowUp");
    await page.keyboard.press("Space");
    await expect(page.getByRole("status").filter({ hasText: /Dropped|Moved/ })).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    const reloadedFirst = await page
      .getByTestId("kanban-column-todo")
      .getByText(first)
      .locator("xpath=ancestor::article[1]")
      .boundingBox();
    const reloadedSecond = await page
      .getByTestId("kanban-column-todo")
      .getByText(second)
      .locator("xpath=ancestor::article[1]")
      .boundingBox();
    expect(reloadedFirst).not.toBeNull();
    expect(reloadedSecond).not.toBeNull();
    if (!reloadedFirst || !reloadedSecond) return;
    expect(reloadedFirst.y > reloadedSecond.y).toBe(true);
  });
});
