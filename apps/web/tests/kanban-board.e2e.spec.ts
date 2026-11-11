import { expect, test } from "./disposable-fixtures";

import { signInPwaOwner, getPwaOwners } from "./pwa-fixtures";

test.describe("kanban drag and manual order", () => {

  test("drag To Do → In Progress persists after reload at desktop and phone", async ({
    page,
  }) => {
    const { ownerA } = getPwaOwners();
    await signInPwaOwner(page, ownerA, "/tasks?layout=kanban&boardOrder=manual&view=active");
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto("/tasks?layout=kanban&boardOrder=manual&view=active");

      const title = `EGA-785 drag ${viewport.width} ${Date.now()}`;
      await page.getByTestId("tasks-new-task").click();
      await page.getByLabel("Command", { exact: true }).fill(title);
      await page.getByLabel("Status", { exact: true }).selectOption("todo");
      await page.getByRole("button", { name: /Create task/i }).click();
      await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });

      const todoColumn = page.getByTestId("kanban-column-todo");
      const handle = todoColumn.getByRole("button", { name: `Drag ${title}`, exact: true });
      const target = page.getByTestId("kanban-column-end-in_progress");

      await handle.scrollIntoViewIfNeeded();
      const source = await handle.boundingBox();
      if (!source) throw new Error("Drag source is missing.");

      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(source.x + source.width / 2 + 12, source.y + 12, { steps: 4 });
      await target.scrollIntoViewIfNeeded();
      const destination = await target.boundingBox();
      if (!destination) throw new Error("Drag destination is missing.");
      await page.mouse.move(
        destination.x + destination.width / 2,
        destination.y + destination.height / 2,
        { steps: 16 },
      );
      const persistedMove = page.waitForResponse(response =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/tasks" && Boolean(response.request().headers()["next-action"]),
      );
      await page.mouse.up();
      expect((await persistedMove).ok()).toBe(true);

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
      await page.getByLabel("Command", { exact: true }).fill(title);
      await page.getByLabel("Status", { exact: true }).selectOption("todo");
      await page.getByRole("button", { name: /Create task/i }).click();
      await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
    }

    const todoColumn = page.getByTestId("kanban-column-todo");
    const handle = todoColumn.getByRole("button", { name: `Drag ${first}`, exact: true });
    const firstCard = handle.locator("xpath=ancestor::article[1]");
    const secondCard = todoColumn.getByRole("button", { name: `Drag ${second}`, exact: true }).locator("xpath=ancestor::article[1]");
    const initialFirstBox = await firstCard.boundingBox();
    const initialSecondBox = await secondCard.boundingBox();
    expect(initialFirstBox).not.toBeNull();
    expect(initialSecondBox).not.toBeNull();
    if (!initialFirstBox || !initialSecondBox) throw new Error("Initial task cards are missing.");

    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    // Pickup precedes dnd-kit's target measurements; wait for the initial collision.
    await expect(page.getByRole("status").filter({ hasText: /^Not over a column\.$/ })).toHaveCount(1);
    // KeyboardSensor moves by a fixed step, so one arrow does not always reach
    // the next card. Step until the collision announcement names the column.
    const direction = initialFirstBox.y < initialSecondBox.y ? "ArrowDown" : "ArrowUp";
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press(direction);
      if (await page.getByRole("status").filter({ hasText: /Over Todo at position/ }).count()) break;
    }
    await expect(page.getByRole("status").filter({ hasText: /Over Todo at position/ })).toHaveCount(1);
    const persistedOrder = page.waitForResponse(response =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/tasks" && Boolean(response.request().headers()["next-action"]),
    );
    await page.keyboard.press("Space");
    expect((await persistedOrder).ok()).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: /Dropped in Todo/ })).toHaveCount(1, {
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
    if (!reloadedFirst || !reloadedSecond) throw new Error("Reloaded task cards are missing.");
    expect(reloadedFirst.y > reloadedSecond.y).toBe(initialFirstBox.y < initialSecondBox.y);
  });
});
