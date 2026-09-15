import { readFileSync } from "node:fs";
import path from "node:path";

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("./sidebar-logout", () => ({ SidebarLogout: () => null }));

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";

import {
  getTopBarAttentionSignal,
  getTopBarTimerSignal,
} from "./shell-signals";
import { SidebarNavigation } from "./sidebar-navigation";

function read(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

const metrics = buildWorkspaceShellMetrics({
  hasActiveTimer: false,
  blockedTaskCount: 1,
  overdueTaskCount: 3,
  dueTodayTaskCount: 2,
  hasCurrentWeekReview: false,
});

describe("EGA-654 compact top-bar signals", () => {
  it("exposes one attention signal and keeps the timer signal separate", () => {
    expect(getTopBarAttentionSignal(metrics)?.label).toBe("3 overdue");
    expect(getTopBarTimerSignal(metrics)).toBeNull();

    const withTimer = buildWorkspaceShellMetrics({
      hasActiveTimer: true,
      blockedTaskCount: 1,
      overdueTaskCount: 3,
      dueTodayTaskCount: 2,
      hasCurrentWeekReview: false,
    });
    expect(getTopBarTimerSignal(withTimer)?.label).toBe("Timer active");
    // The attention control never becomes the timer signal.
    expect(getTopBarAttentionSignal(withTimer)?.label).toBe("3 overdue");
  });

  it("returns no attention signal when nothing is actionable", () => {
    const clear = buildWorkspaceShellMetrics({
      hasActiveTimer: false,
      blockedTaskCount: 0,
      overdueTaskCount: 0,
      dueTodayTaskCount: 0,
      hasCurrentWeekReview: true,
    });
    expect(getTopBarAttentionSignal(clear)).toBeNull();
  });
});

describe("EGA-654 navigation structure", () => {
  it("top bar uses one compact signal cluster with canonical destinations preserved", () => {
    const topBar = read("components", "layout", "top-bar.tsx");
    expect(topBar).toContain("TopBarCompactSignals");
    expect(topBar).not.toContain("TopBarSignalCluster");
    // Timer, search, notifications and profile remain present.
    expect(topBar).toContain("workspace-search-trigger");
    expect(topBar).toContain("/notifications");
    expect(topBar).toContain("Account settings");
  });

  it("EGA-654: tablet sidebar and accessibility contract agree", () => {
    const sidebar = read("components", "layout", "sidebar.tsx");
    expect(sidebar).toContain('data-collapsed={collapsed ? "true" : "false"}');
    expect(sidebar).toContain('data-testid="sidebar-collapse-toggle"');
    expect(sidebar).toContain("compact={collapsed}");

    const css = read("components", "layout", "editorial-shell.css");
    expect(css).toContain('.workspace-sidebar[data-collapsed="true"]');
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).toContain(".sidebar-active-indicator");
    // Icon-only states hide the text wrappers explicitly, not only via font-size.
    expect(css).toContain(".workspace-capture-trigger-copy");
    expect(css).toContain(".workspace-create-task-copy");
    // Tablet widths keep labels visible and the collapse control available.
    expect(css).toMatch(
      /@media \(min-width: 761px\) and \(max-width: 1180px\)[\s\S]*?--workspace-sidebar-width:\s*clamp\(15rem, 24vw, 17rem\)/,
    );
    expect(css).toMatch(/@media \(min-width: 761px\)[\s\S]*?data-collapsed="true"/);
    expect(css).toContain("max-height: none;");
    expect(css).toContain("overflow-y: visible;");
    expect(css).not.toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.workspace-sidebar-collapse\s*\{[\s\S]*?display:\s*none/);

    const navigation = read("components", "layout", "sidebar-navigation.tsx");
    expect(navigation).toContain("sidebar-active-indicator");
    // Names are unconditional (not gated on the compact prop).
    expect(navigation).toContain("aria-label={route.label}");
    expect(navigation).toContain("aria-label={project.name}");
  });
});

describe("EGA-654 collapsed sidebar keeps every destination", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderCompact(compact: boolean) {
    await act(async () => {
      root.render(<SidebarNavigation metrics={metrics} compact={compact} />);
    });
  }

  it("renders the same route destinations expanded and collapsed", async () => {
    await renderCompact(false);
    const expandedHrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );

    await renderCompact(true);
    const collapsedHrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );

    expect(collapsedHrefs).toEqual(expandedHrefs);
  });

  it("EGA-654: every destination keeps an accessible name and tooltip in both visual states", async () => {
    // The CSS auto-compact interval hides labels while React `compact` stays
    // false, so names must not depend on the compact prop.
    for (const compact of [false, true]) {
      await renderCompact(compact);

      const today = container.querySelector('a[href="/today"]');
      expect(today?.getAttribute("aria-label")).toBe("Today");
      expect(today?.getAttribute("title")).toBe("Today");
      expect(today?.getAttribute("aria-current")).toBe("page");

      for (const link of Array.from(container.querySelectorAll("a"))) {
        const name = link.getAttribute("aria-label") ?? link.textContent?.trim() ?? "";
        expect(name.length).toBeGreaterThan(0);
      }
    }
  });
});
