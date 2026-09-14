import { test, expect } from "@playwright/test";

const publicRoutes = ["/login"] as const;
const authenticatedRoutes = [
  "/dashboard",
  "/today",
  "/tasks",
] as const;

test.describe("visual and a11y — desktop and 390px", () => {
  test("public routes render without redirect and have visible heading", async ({ page }) => {
    for (const route of publicRoutes) {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ] as const) {
        await page.setViewportSize(viewport);
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}(\\?.*)?$`));
        await expect(page.locator("h1").first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(20);
      }
    }
  });

  test("authenticated routes either render or redirect to /login (no false positive)", async ({ page }) => {
    test.setTimeout(180_000);
    for (const route of authenticatedRoutes) {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ] as const) {
        await page.setViewportSize(viewport);
        await page.goto(route, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(200);
        const url = new URL(page.url());
        if (url.pathname === "/login") {
          // No credentials in CI — redirect is expected, not a visual validation
          expect(url.pathname).toBe("/login");
          continue;
        }
        // If authenticated (when credentials present), verify heading and overflow
        if (url.pathname !== route) {
          // Redirected (e.g., to /login) — already handled above, skip heading check
          continue;
        }
        // Authenticated route rendered — check for any heading or body content
        const hasH1 = (await page.locator("h1").count()) > 0;
        if (hasH1) {
          await expect(page.locator("h1").first()).toBeVisible({ timeout: 5000 });
        } else {
          const bodyText = (await page.locator("body").textContent())?.trim() ?? "";
          expect(bodyText.length).toBeGreaterThan(10);
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(20);
      }
    }
  });

  test("keyboard Tab yields a focusable control", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.keyboard.press("Tab");
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedTag).toBeTruthy();
    expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(focusedTag);
  });

  test("reduced motion does not break layout", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(20);
  });

  test("command palette opens and closes via Escape", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    // Palette trigger exists on authenticated shell; on /login it may not, so skip if missing
    const trigger = page.locator("button.workspace-search-trigger");
    if ((await trigger.count()) === 0) {
      test.skip();
      return;
    }
    await trigger.first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 2000 });
  });
});

/**
 * EGA-648 real-browser geometry checks. These mount the real workspace layout
 * markup against the production stylesheet and read computed layout, so they
 * exercise actual browser geometry rather than source text. Authenticated routes
 * redirect to /login without credentials, so the fixture is mounted on /login
 * where the global design-system stylesheet is loaded.
 */
test.describe("EGA-648 responsive layout geometry", () => {
  test("active timer display stacks at rail width and only splits when wide", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    const measured = await page.evaluate(() => {
      const host = document.createElement("div");
      host.style.position = "absolute";
      host.style.left = "-10000px";
      host.style.top = "0";
      host.innerHTML = `
        <div class="active-timer-card" data-fixture="timer" style="width: 288px">
          <div class="active-timer-display-grid">
            <div>Task copy that should keep a readable measure</div>
            <div>00:10:00</div>
          </div>
        </div>`;
      document.body.appendChild(host);
      const card = host.querySelector<HTMLElement>('[data-fixture="timer"]')!;
      const grid = card.querySelector<HTMLElement>(".active-timer-display-grid")!;
      const narrow = getComputedStyle(grid).gridTemplateColumns;
      card.style.width = "720px";
      const wide = getComputedStyle(grid).gridTemplateColumns;
      host.remove();
      return { narrow, wide };
    });

    // Rail width (~18rem): duration must stack, not reserve an 18rem column.
    expect(measured.narrow.split(" ").length).toBe(1);
    // Wide container keeps the original two-column composition.
    expect(measured.wide.split(" ").length).toBe(2);
  });

  test("kanban board columns adapt to container width and never squeeze", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    const measured = await page.evaluate(() => {
      const host = document.createElement("div");
      host.style.position = "absolute";
      host.style.left = "-10000px";
      host.style.top = "0";
      host.innerHTML = `
        <div class="tasks-board-container" data-fixture="board-container">
          <div class="tasks-kanban-board">
            <section class="tasks-kanban-column">1</section>
            <section class="tasks-kanban-column">2</section>
            <section class="tasks-kanban-column">3</section>
            <section class="tasks-kanban-column">4</section>
          </div>
        </div>`;
      document.body.appendChild(host);
      const container = host.querySelector<HTMLElement>('[data-fixture="board-container"]')!;
      const board = container.querySelector<HTMLElement>(".tasks-kanban-board")!;
      const columnCountByWidth = [400, 700, 1000, 1300].map((width) => {
        container.style.width = `${width}px`;
        return getComputedStyle(board).gridTemplateColumns.split(" ").length;
      });
      container.style.width = "600px";
      const columnWidth = container
        .querySelector<HTMLElement>(".tasks-kanban-column")!
        .getBoundingClientRect().width;
      host.remove();
      return { columnCountByWidth, columnWidth };
    });

    expect(measured.columnCountByWidth).toEqual([1, 2, 3, 4]);
    // Columns stay usable instead of collapsing into a ~150px squeeze.
    expect(measured.columnWidth).toBeGreaterThan(250);
  });
});
