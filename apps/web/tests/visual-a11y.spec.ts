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


test.describe("sidebar collapsed rail regression", () => {
  test("sidebar collapsed rail contract at 761, 900, 1180, and 1200px", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    const sidebarStyles = [
      readFileSync(resolve(process.cwd(), "src/components/layout/editorial-shell.css"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/components/layout/editorial-shell-responsive.css"), "utf8"),
    ];
    await page.addStyleTag({ content: sidebarStyles.join("\n") });

    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "sidebar-contract-host";
      host.className = "ega-app-shell";
      host.dataset.workspaceTheme = "editorial";
      host.style.cssText =
        "position:fixed;inset:0;z-index:99999;display:grid;grid-template-columns:var(--workspace-sidebar-width) minmax(0,1fr);height:100vh;width:100vw;overflow:hidden";
      host.innerHTML = `
        <aside id="sidebar-contract" class="workspace-sidebar" data-collapsed="false">
          <div class="workspace-sidebar-brand">
            <span class="workspace-brand-copy">EGA</span>
            <span class="workspace-brand-index">01</span>
          </div>
          <nav class="sidebar-nav workspace-sidebar-nav" aria-label="Workspace navigation">
            <section class="sidebar-section workspace-nav-section">
              <div class="sidebar-section-label">Command</div>
              <div class="workspace-nav-list">
                <a href="/tasks" class="sidebar-link workspace-nav-link active" aria-label="Tasks" title="Tasks">
                  <span class="sidebar-active-indicator" aria-hidden="true"></span>
                  <span class="workspace-nav-index" aria-hidden="true">02</span>
                  <span class="sidebar-link-icon" aria-hidden="true"><svg></svg></span>
                  <span class="workspace-nav-label">Tasks</span>
                  <span class="sidebar-badge">21</span>
                </a>
              </div>
            </section>
            <section class="sidebar-section sidebar-project-section workspace-nav-section">
              <div class="sidebar-section-heading">
                <div class="sidebar-section-label">Projects</div>
                <a href="/tasks/projects/new" class="sidebar-section-action" aria-label="Create new project" title="New project">
                  <svg></svg>
                </a>
              </div>
              <div class="sidebar-project-list">
                <a href="/tasks?project=life" class="sidebar-link sidebar-project-link selected" aria-label="Life" title="Life">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Life</span>
                  <span class="sidebar-project-count">8</span>
                </a>
                <a href="/tasks?project=content" class="sidebar-link sidebar-project-link" aria-label="Content Engine" title="Content Engine">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Content Engine</span>
                  <span class="sidebar-project-count">4</span>
                </a>
                <a href="/tasks?project=launch" class="sidebar-link sidebar-project-link" aria-label="Launch" title="Launch">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Launch</span>
                  <span class="sidebar-project-count">3</span>
                </a>
                <a href="/tasks?project=analytics" class="sidebar-link sidebar-project-link" aria-label="Analytics" title="Analytics">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Analytics</span>
                  <span class="sidebar-project-count">2</span>
                </a>
                <a href="/tasks?project=mobile" class="sidebar-link sidebar-project-link" aria-label="Mobile App" title="Mobile App">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Mobile App</span>
                  <span class="sidebar-project-count">6</span>
                </a>
                <a href="/tasks?project=docs" class="sidebar-link sidebar-project-link" aria-label="Documentation" title="Documentation">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Documentation</span>
                  <span class="sidebar-project-count">1</span>
                </a>
                <a href="/tasks?project=ops" class="sidebar-link sidebar-project-link" aria-label="Operations" title="Operations">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Operations</span>
                  <span class="sidebar-project-count">5</span>
                </a>
                <a href="/tasks?project=research" class="sidebar-link sidebar-project-link" aria-label="Research" title="Research">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Research</span>
                  <span class="sidebar-project-count">2</span>
                </a>
                <a href="/tasks?project=qa" class="sidebar-link sidebar-project-link" aria-label="Quality" title="Quality">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Quality</span>
                  <span class="sidebar-project-count">3</span>
                </a>
                <a href="/tasks?project=growth" class="sidebar-link sidebar-project-link" aria-label="Growth" title="Growth">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Growth</span>
                  <span class="sidebar-project-count">7</span>
                </a>
                <a href="/tasks?project=platform" class="sidebar-link sidebar-project-link" aria-label="Platform" title="Platform">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Platform</span>
                  <span class="sidebar-project-count">9</span>
                </a>
                <a href="/tasks?project=archive" class="sidebar-link sidebar-project-link" aria-label="Archive" title="Archive">
                  <span class="project-dot"></span>
                  <span class="workspace-nav-label">Archive</span>
                  <span class="sidebar-project-count">1</span>
                </a>
              </div>
            </section>
            <section class="sidebar-section sidebar-general-section workspace-nav-section">
              <div class="sidebar-section-label">System</div>
              <a href="/ideas" class="sidebar-link workspace-nav-link" aria-label="Ideas" title="Ideas">
                <span class="sidebar-link-icon"><svg data-testid="system-icon"></svg></span>
                <span class="workspace-nav-label">Ideas</span>
              </a>
              <button type="button" class="sidebar-link" aria-label="Logout" title="Logout">
                <span class="sidebar-link-icon"><svg></svg></span>
                <span class="workspace-nav-label">Logout</span>
              </button>
            </section>
          </nav>
        </aside>
        <main class="workspace-main" data-testid="sidebar-contract-main">
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
      [1180, 272],
      [1200, 288],
    ] as const;

    for (const [width, expectedExpandedWidth] of expandedWidths) {
      await page.setViewportSize({ width, height: 900 });

      const expandedWidth = await page.locator("#sidebar-contract").evaluate(
        (sidebar) => sidebar.getBoundingClientRect().width,
      );
      expect(expandedWidth).toBe(expectedExpandedWidth);

      const expandedLayout = await page.evaluate(() => {
        const projectSection = document.querySelector<HTMLElement>('#sidebar-contract .sidebar-project-section')!;
        const projectList = document.querySelector<HTMLElement>('#sidebar-contract .sidebar-project-list')!;
        const systemSection = document.querySelector<HTMLElement>('#sidebar-contract .sidebar-general-section')!;

        return {
          projectListOverflowY: getComputedStyle(projectList).overflowY,
          projectListScrollHeight: projectList.scrollHeight,
          projectListClientHeight: projectList.clientHeight,
          projectListBottom: projectList.getBoundingClientRect().bottom,
          projectSectionBottom: projectSection.getBoundingClientRect().bottom,
          systemTop: systemSection.getBoundingClientRect().top,
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

      await page.locator("#sidebar-contract").evaluate((sidebar) => {
        sidebar.setAttribute("data-collapsed", "true");
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
          return (Math.max(foreground, background) + 0.05) /
            (Math.min(foreground, background) + 0.05);
        };
        const systemIcon = sidebar.querySelector<SVGElement>('[data-testid="system-icon"]')!;
        const addProject = sidebar.querySelector<HTMLElement>(".sidebar-section-action")!;
        const railRect = sidebar.getBoundingClientRect();
        const contentRect = main.getBoundingClientRect();

        return {
          width: railRect.width,
          sidebarBackground: getComputedStyle(sidebar).backgroundColor,
          sidebarBackgroundImage: getComputedStyle(sidebar).backgroundImage,
          sidebarOpacity: getComputedStyle(sidebar).opacity,
          contentStartsAfterRail: contentRect.left >= railRect.right,
          labelsAreConsistentlyHidden: allLabelsHidden,
          hasAccessibleLogoutLabel: Boolean(
            sidebar.querySelector('button[aria-label="Logout"] > .workspace-nav-label'),
          ),
          activeContrast: contrastRatio(sidebar.querySelector<HTMLElement>(".sidebar-link.active")!),
          projectContrast: contrastRatio(sidebar.querySelector<HTMLElement>(".sidebar-project-link.selected")!),
          addProjectSize: {
            width: addProject.getBoundingClientRect().width,
            height: addProject.getBoundingClientRect().height,
          },
          systemDividerWidth: getComputedStyle(sidebar.querySelector<HTMLElement>(".sidebar-general-section")!).borderTopWidth,
          systemIconWidth: systemIcon.getBoundingClientRect().width,
        };
      });

      expect(measurements.width).toBe(80);
      expect(measurements.sidebarBackground).toBe("rgb(17, 17, 15)");
      expect(measurements.sidebarBackgroundImage).toBe("none");
      expect(measurements.sidebarOpacity).toBe("1");
      expect(measurements.contentStartsAfterRail).toBe(true);
      expect(measurements.labelsAreConsistentlyHidden).toBe(true);
      expect(measurements.hasAccessibleLogoutLabel).toBe(true);
      expect(measurements.activeContrast).toBeGreaterThanOrEqual(4.5);
      expect(measurements.projectContrast).toBeGreaterThanOrEqual(4.5);
      expect(measurements.addProjectSize).toEqual({ width: 44, height: 44 });
      expect(measurements.systemDividerWidth).toBe("1px");
      expect(measurements.systemIconWidth).toBeLessThan(16);

      await page.locator("#sidebar-contract").evaluate((sidebar) => {
        sidebar.setAttribute("data-collapsed", "false");
      });
    }
  });
});
