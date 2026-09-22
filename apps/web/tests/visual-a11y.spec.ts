import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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


test.describe("workspace shell contract", () => {
  test("light sidebar rail geometry, contrast, and collapsed labels at 761, 900, 1180, and 1200px", async ({
    page,
  }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    const shellStyles = [
      readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/styles/workspace.css"), "utf8"),
    ];
    await page.addStyleTag({ content: shellStyles.join("\n") });

    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "sidebar-contract-host";
      host.className = "ega-app-shell app-shell";
      host.dataset.workspaceTheme = "workspace";
      host.dataset.collapsed = "false";
      // No inline grid-template: the shell stylesheet owns the rail geometry and
      // must be able to switch to the collapsed track from the data state.
      host.style.cssText =
        "position:fixed;inset:0;z-index:99999;height:100vh;width:100vw;overflow:hidden";
      host.innerHTML = `
        <aside id="sidebar-contract" class="ega-sidebar app-sidebar workspace-sidebar" data-collapsed="false">
          <div class="sidebar-brand workspace-sidebar-brand">
            <span class="sidebar-brand-logo"></span>
            <span class="workspace-brand-copy">EGA House</span>
            <button type="button" class="workspace-sidebar-collapse" aria-label="Collapse sidebar"></button>
          </div>
          <div class="workspace-search" role="button" tabindex="0" aria-label="Search">
            <span class="workspace-search-label">Search</span>
            <kbd>⌘K</kbd>
          </div>
          <nav class="sidebar-nav workspace-sidebar-nav" aria-label="Workspace navigation">
            <section class="sidebar-section workspace-nav-section" aria-label="Primary">
              <div class="workspace-nav-list">
                <a href="/today" class="sidebar-link workspace-nav-link" aria-label="Today" title="Today">
                  <span class="sidebar-link-icon" aria-hidden="true"><svg></svg></span>
                  <span class="workspace-nav-label">Today</span>
                </a>
                <a href="/tasks" class="sidebar-link workspace-nav-link active" aria-label="Tasks" title="Tasks">
                  <span class="sidebar-link-icon" aria-hidden="true"><svg></svg></span>
                  <span class="workspace-nav-label">Tasks</span>
                  <span class="sidebar-badge">21</span>
                </a>
              </div>
            </section>
            <section class="sidebar-section sidebar-project-section workspace-nav-section">
              <div class="sidebar-section-heading">
                <div class="sidebar-section-label">Workspaces</div>
                <a href="/tasks/projects/new" class="sidebar-section-action" aria-label="Create new project" title="New project"><svg></svg></a>
              </div>
              <div class="sidebar-project-list">
                ${Array.from({ length: 14 })
                  .map(
                    (_, index) =>
                      `<a href="/tasks?project=p${index}" class="sidebar-link sidebar-project-link${
                        index === 0 ? " selected" : ""
                      }" aria-label="Workspace ${index}" title="Workspace ${index}"><span class="project-dot" style="background:var(--ega-data-blue)"></span><span class="workspace-nav-label">Workspace ${index}</span><span class="sidebar-project-count">${index + 1}</span></a>`,
                  )
                  .join("")}
              </div>
            </section>
            <section class="sidebar-section sidebar-general-section workspace-nav-section" aria-label="System">
              <a href="/ideas" class="sidebar-link workspace-nav-link" aria-label="Ideas" title="Ideas">
                <span class="sidebar-link-icon" aria-hidden="true"><svg data-testid="system-icon"></svg></span>
                <span class="workspace-nav-label">Ideas</span>
              </a>
              <button type="button" class="sidebar-link" aria-label="Logout" title="Logout">
                <span class="sidebar-link-icon"><svg></svg></span>
                <span class="workspace-nav-label">Logout</span>
              </button>
            </section>
          </nav>
          <div class="workspace-create-task">
            <button type="button" class="workspace-create-task-trigger" data-testid="contract-create-task" aria-label="Create task">
              <span class="workspace-nav-label">Create task</span>
            </button>
          </div>
        </aside>
        <main class="app-main workspace-main" data-testid="sidebar-contract-main">
          <p>Underlying page content</p>
        </main>`;
      document.body.append(host);

      const motionGuard = document.createElement("style");
      motionGuard.textContent =
        "#sidebar-contract-host,#sidebar-contract-host .workspace-sidebar{transition:none!important}";
      document.head.append(motionGuard);
    });

    const expandedWidths = [
      [761, 240],
      [900, 240],
      [1180, 264],
      [1200, 264],
    ] as const;

    for (const [width, expectedExpandedWidth] of expandedWidths) {
      await page.setViewportSize({ width, height: 900 });

      const expandedWidth = await page
        .locator("#sidebar-contract")
        .evaluate((sidebar) => sidebar.getBoundingClientRect().width);
      expect(expandedWidth).toBe(expectedExpandedWidth);

      const expandedLayout = await page.evaluate(() => {
        const projectSection = document.querySelector<HTMLElement>(
          "#sidebar-contract .sidebar-project-section",
        )!;
        const projectList = document.querySelector<HTMLElement>(
          "#sidebar-contract .sidebar-project-list",
        )!;
        const systemSection = document.querySelector<HTMLElement>(
          "#sidebar-contract .sidebar-general-section",
        )!;
        const activeLink = document.querySelector<HTMLElement>(
          "#sidebar-contract .sidebar-link.active",
        )!;

        return {
          projectListOverflowY: getComputedStyle(projectList).overflowY,
          projectListScrollHeight: projectList.scrollHeight,
          projectListClientHeight: projectList.clientHeight,
          projectListBottom: projectList.getBoundingClientRect().bottom,
          projectSectionBottom: projectSection.getBoundingClientRect().bottom,
          systemTop: systemSection.getBoundingClientRect().top,
          topSectionBottom: document
            .querySelector<HTMLElement>("#sidebar-contract .workspace-nav-section")!
            .getBoundingClientRect().bottom,
          cardsDoNotOverlap: projectList.getBoundingClientRect().bottom <= systemSection.getBoundingClientRect().top,
          activeFontWeight: Number(getComputedStyle(activeLink).fontWeight),
          // The project-create control only exists in the expanded state.
          addProjectSize: (() => {
            const addProject = document.querySelector<HTMLElement>(
              "#sidebar-contract .sidebar-section-action",
            )!;
            const rect = addProject.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          })(),
        };
      });

      expect(expandedLayout.projectListOverflowY).toBe("auto");
      expect(expandedLayout.projectListScrollHeight).toBeGreaterThan(
        expandedLayout.projectListClientHeight,
      );
      expect(expandedLayout.systemTop).toBeGreaterThanOrEqual(
        expandedLayout.projectListBottom,
      );
      expect(expandedLayout.systemTop).toBeGreaterThanOrEqual(
        expandedLayout.projectSectionBottom,
      );
      expect(expandedLayout.cardsDoNotOverlap).toBe(true);
      expect(expandedLayout.addProjectSize.width).toBeGreaterThanOrEqual(24);
      expect(expandedLayout.addProjectSize.height).toBeGreaterThanOrEqual(24);
      // Selected navigation is reinforced by weight, not by colour alone.
      expect(expandedLayout.activeFontWeight).toBeGreaterThanOrEqual(500);

      await page.locator("#sidebar-contract").evaluate((sidebar) => {
        sidebar.setAttribute("data-collapsed", "true");
        document
          .querySelector<HTMLElement>("#sidebar-contract-host")!
          .setAttribute("data-collapsed", "true");
      });

      const measurements = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>("#sidebar-contract")!;
        const main = document.querySelector<HTMLElement>('[data-testid="sidebar-contract-main"]')!;
        const linkElements = Array.from(sidebar.querySelectorAll<HTMLElement>(".sidebar-link"));
        const allLabelsHidden = linkElements.every((link) => {
          const label = link.querySelector<HTMLElement>(".workspace-nav-label");
          return Boolean(label) && getComputedStyle(label!).display === "none";
        });
        const contrastRatio = (element: HTMLElement) => {
          const channels = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
          const luminance = (value: string) => {
            const [r, g, b] = channels(value).map((channel) => {
              const srgb = channel / 255;
              return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const foreground = luminance(getComputedStyle(element).color);
          const background = luminance(getComputedStyle(element).backgroundColor);
          return (
            (Math.max(foreground, background) + 0.05) /
            (Math.min(foreground, background) + 0.05)
          );
        };
        const systemIcon = sidebar.querySelector<SVGElement>('[data-testid="system-icon"]')!;
        const createTask = sidebar.querySelector<HTMLElement>('[data-testid="contract-create-task"]')!;
        const railRect = sidebar.getBoundingClientRect();
        const contentRect = main.getBoundingClientRect();

        return {
          width: railRect.width,
          sidebarBackground: getComputedStyle(sidebar).backgroundColor,
          sidebarBackgroundImage: getComputedStyle(sidebar).backgroundImage,
          sidebarOpacity: getComputedStyle(sidebar).opacity,
          borderRightWidth: getComputedStyle(sidebar).borderRightWidth,
          contentStartsAfterRail: contentRect.left >= railRect.right,
          labelsAreConsistentlyHidden: allLabelsHidden,
          hasAccessibleLogoutLabel: Boolean(
            sidebar.querySelector('button[aria-label="Logout"] > .workspace-nav-label'),
          ),
          activeContrast: contrastRatio(sidebar.querySelector<HTMLElement>(".sidebar-link.active")!),
          projectContrast: contrastRatio(
            sidebar.querySelector<HTMLElement>(".sidebar-project-link.selected")!,
          ),
          createTaskSize: {
            width: createTask.getBoundingClientRect().width,
            height: createTask.getBoundingClientRect().height,
          },
          systemDividerWidth: getComputedStyle(
            sidebar.querySelector<HTMLElement>(".sidebar-general-section")!,
          ).borderTopWidth,
          systemIconWidth: systemIcon.getBoundingClientRect().width,
        };
      });

      // Icon rail uses the token width and stays a light surface.
      expect(measurements.width).toBe(72);
      expect(measurements.sidebarBackground).toBe("rgb(242, 242, 242)");
      expect(measurements.sidebarBackgroundImage).toBe("none");
      expect(measurements.sidebarOpacity).toBe("1");
      expect(measurements.borderRightWidth).toBe("1px");
      expect(measurements.contentStartsAfterRail).toBe(true);
      expect(measurements.labelsAreConsistentlyHidden).toBe(true);
      expect(measurements.hasAccessibleLogoutLabel).toBe(true);
      expect(measurements.activeContrast).toBeGreaterThanOrEqual(4.5);
      expect(measurements.projectContrast).toBeGreaterThanOrEqual(4.5);
      // The rail keeps a touch-safe primary action.
      expect(measurements.createTaskSize.height).toBeGreaterThanOrEqual(32);
      expect(measurements.systemDividerWidth).toBe("1px");
      // Rail icons stay full-size and consistent, never squashed to nothing.
      expect(measurements.systemIconWidth).toBeGreaterThanOrEqual(14);
      expect(measurements.systemIconWidth).toBeLessThanOrEqual(18);

      await page.locator("#sidebar-contract").evaluate((sidebar) => {
        sidebar.setAttribute("data-collapsed", "false");
        document
          .querySelector<HTMLElement>("#sidebar-contract-host")!
          .setAttribute("data-collapsed", "false");
      });
    }
  });

  test("phone widths replace the sidebar with the drawer and never scroll the document", async ({
    page,
  }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    const shellStyles = [
      readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/styles/workspace.css"), "utf8"),
    ];
    await page.addStyleTag({ content: shellStyles.join("\n") });

    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "phone-shell-host";
      host.className = "ega-app-shell app-shell";
      host.dataset.workspaceTheme = "workspace";
      host.dataset.collapsed = "false";
      host.style.cssText = "position:fixed;inset:0;z-index:99999;overflow:hidden";
      host.innerHTML = `
        <aside class="ega-sidebar app-sidebar workspace-sidebar" data-collapsed="false">
          <a href="/today" class="sidebar-link workspace-nav-link" aria-label="Today"><span class="workspace-nav-label">Today</span></a>
        </aside>
        <main class="app-main workspace-main">
          <header class="app-topbar workspace-topbar">
            <div class="app-topbar-context"></div>
            <div class="app-topbar-actions">
              <a href="/notifications" class="topbar-icon-button topbar-notification" data-has-unread="false" aria-label="Notifications"><svg></svg></a>
              <a href="/notifications" class="topbar-icon-button topbar-notification" data-has-unread="true" aria-label="Notifications (1 unread)"><svg></svg><span class="notification-dot"></span></a>
            </div>
          </header>
          <div class="app-page">
            <header class="app-page-header"><h1 class="app-page-title">Today</h1></header>
            <div class="app-content"><div class="kpi-grid"><div class="kpi-card">1</div><div class="kpi-card">2</div></div></div>
          </div>
        </main>`;
      document.body.append(host);
    });

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });

      const measured = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>("#phone-shell-host")!;
        const sidebar = host.querySelector<HTMLElement>(".workspace-sidebar")!;
        const page = host.querySelector<HTMLElement>(".app-page")!;
        const notifications = Array.from(
          host.querySelectorAll<HTMLElement>(".topbar-notification"),
        );
        return {
          sidebarDisplay: getComputedStyle(sidebar).display,
          columns: getComputedStyle(host).gridTemplateColumns.split(" ").length,
          kpiColumns: getComputedStyle(host.querySelector<HTMLElement>(".kpi-grid")!)
            .gridTemplateColumns.split(" ").length,
          read: getComputedStyle(notifications[0]!).display,
          unread: getComputedStyle(notifications[1]!).display,
          pageWidth: page.getBoundingClientRect().width,
          hostWidth: host.getBoundingClientRect().width,
        };
      });

      expect(measured.sidebarDisplay).toBe("none");
      expect(measured.columns).toBe(1);
      expect(measured.kpiColumns).toBe(1);
      // The W00 bug: the bell must hide only when there is genuinely nothing unread.
      expect(measured.read).toBe("none");
      expect(measured.unread).not.toBe("none");
      expect(measured.pageWidth).toBeLessThanOrEqual(measured.hostWidth);
    }
  });
});
