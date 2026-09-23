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

import { SidebarNavigation, type SidebarProject } from "./sidebar-navigation";

const metrics = buildWorkspaceShellMetrics({
  hasActiveTimer: false,
  blockedTaskCount: 0,
  overdueTaskCount: 0,
  dueTodayTaskCount: 0,
  hasCurrentWeekReview: true,
});

const projects: SidebarProject[] = [
  { id: "project-1", name: "LIFE", slug: "life", status: "active", activeTaskCount: 12, isPinned: false },
  { id: "project-2", name: "Quiet", slug: "quiet", status: "active", activeTaskCount: 0, isPinned: false },
];

describe("workspace sidebar refinement", () => {
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

  it("names what the compact project count counts", async () => {
    await act(async () => {
      root.render(<SidebarNavigation projects={projects} metrics={metrics} />);
    });

    const life = container.querySelector<HTMLAnchorElement>('a[href="/tasks?project=project-1"]');
    expect(life).not.toBeNull();
    expect(life?.getAttribute("aria-label")).toBe("LIFE — 12 active tasks");
    expect(life?.getAttribute("title")).toBe("LIFE — 12 active tasks");
    expect(life?.textContent).toContain("12");

    const quiet = container.querySelector<HTMLAnchorElement>('a[href="/tasks?project=project-2"]');
    expect(quiet).not.toBeNull();
    expect(quiet?.getAttribute("aria-label")).toBe("Quiet");
    expect(quiet?.getAttribute("title")).toBe("Quiet");
    expect(quiet?.textContent).not.toContain("0");
  });

  it("keeps one scroll region between a pinned top and a pinned bottom", () => {
    const sidebar = readFileSync(
      path.join(process.cwd(), "src/components/layout/sidebar.tsx"),
      "utf8",
    );

    const asideTag = sidebar.match(/<aside[^>]*>/)?.[0] ?? "";
    expect(asideTag).not.toContain("overflow-y-auto");

    // Brand and search sit above the scroll region and cannot scroll away.
    expect(sidebar).toMatch(/shrink-0[\s\S]*?workspace-sidebar-brand/);
    expect(sidebar).toMatch(/shrink-0[\s\S]*?WorkspaceSearchTrigger/);

    // Exactly one scrollable middle region owns the navigation.
    expect(sidebar.match(/overflow-y-auto/g)?.length).toBe(1);
    expect(sidebar).toContain("overscroll-contain");
    expect(sidebar).toContain('className="overflow-visible"');

    // Capture and Create task stay pinned below the scroll region.
    expect(sidebar).toMatch(
      /mt-1 flex shrink-0[\s\S]*?InboxCaptureTrigger[\s\S]*?SidebarCreateTaskButton/,
    );

    // The project list keeps its own bounded scroll containment.
    const css = readFileSync(
      path.join(process.cwd(), "src/styles/workspace.css"),
      "utf8",
    );
    const projectListRule = css.slice(
      css.indexOf(".sidebar-project-list"),
      css.indexOf("}", css.indexOf(".sidebar-project-list")),
    );
    expect(projectListRule).toContain("max-height: min(31dvh, 18rem);");
    expect(projectListRule).toContain("overflow-y: auto;");
    expect(projectListRule).toContain("overscroll-behavior: contain;");
  });
});
