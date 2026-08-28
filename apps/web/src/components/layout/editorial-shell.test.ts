import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pathFor = (path: string) => resolve(root, path);
const read = (path: string) => readFileSync(pathFor(path), "utf8");

const requiredShellFiles = [
  "src/components/layout/editorial-shell.css",
  "src/components/layout/editorial-shell-responsive.css",
  "src/components/layout/shell-route-meta.ts",
  "src/components/layout/sidebar-navigation.tsx",
  "src/components/layout/sidebar-mobile-drawer.tsx",
] as const;

describe("editorial authenticated workspace shell", () => {
  it("provides focused shared shell modules", () => {
    for (const file of requiredShellFiles) {
      expect(existsSync(pathFor(file)), `${file} should exist`).toBe(true);
    }
  });

  it("defines the command routes once with stable operational numbering", () => {
    const routeMeta = read("src/components/layout/shell-route-meta.ts");

    for (const entry of [
      ["01", "Dashboard", "/dashboard"],
      ["02", "Today", "/today"],
      ["03", "Tasks", "/tasks"],
      ["04", "Goals", "/goals"],
      ["05", "Timer", "/timer"],
      ["06", "Review", "/review"],
      ["07", "Analytics", "/work-analytics"],
    ]) {
      expect(routeMeta).toContain(`index: "${entry[0]}"`);
      expect(routeMeta).toContain(`label: "${entry[1]}"`);
      expect(routeMeta).toContain(`href: "${entry[2]}"`);
    }

    expect(routeMeta).toContain("getShellRouteMeta");
  });

  it("applies the editorial theme through the existing AppShell boundary", () => {
    const appShell = read("src/components/layout/app-shell.tsx");

    expect(appShell).toContain('import "./editorial-shell.css"');
    expect(appShell).toContain('import "./editorial-shell-responsive.css"');
    expect(appShell).toContain('data-workspace-theme="editorial"');
    expect(appShell).toContain("getSidebarProjects");
    expect(appShell).toContain("getSidebarGoals");
    expect(appShell).toContain("getWorkspaceShellMetrics");
  });

  it("uses canonical navigation for every project destination", () => {
    const navigation = read("src/components/layout/sidebar-navigation.tsx");

    expect(navigation).toContain('canonicalUrl.resolve("/tasks/projects/new")');
    expect(navigation).toContain("canonicalUrl.resolve(`/tasks?project=${project.id}`)");
    expect(navigation).toContain('canonicalUrl.resolve("/tasks/projects")');
  });

  it("defines black signal, cream canvas, responsive and reduced-motion contracts", () => {
    const css = read("src/components/layout/editorial-shell.css");

    expect(css).toContain('[data-workspace-theme="editorial"]');
    expect(css).toContain("--workspace-black: #11110f");
    expect(css).toContain("--workspace-cream: #f4efe3");
    expect(css).toContain("--workspace-citrus: #ffd400");
    expect(css).toContain("--workspace-signal: #ff4b2b");
    expect(css).toContain("@media (max-width: 1180px)");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("@media (max-width: 420px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("overflow-x: clip");
  });

  it("keeps full labels in the mobile drawer and compacts logout only in the tablet rail", () => {
    const css = read("src/components/layout/editorial-shell-responsive.css");

    expect(css).toContain(".workspace-drawer-panel .workspace-nav-label");
    expect(css).toContain(".workspace-drawer-panel .workspace-nav-index");
    expect(css).toContain(".workspace-drawer-panel .sidebar-section-label");
    expect(css).toContain("display: inline");
    expect(css).toContain("@media (min-width: 761px) and (max-width: 1180px)");
    expect(css).toMatch(
      /\.workspace-sidebar\s+\.sidebar-general-section\s+form\s+\.sidebar-link\s*\{/,
    );
    expect(css).toContain("font-size: 0");
    expect(css).toContain("[data-workspace-theme=\"editorial\"]::before");
    expect(css).toContain("inset: 0");
  });

  it("preserves the dashboard data and failure-isolation boundaries", () => {
    const dashboard = read("src/app/dashboard/page.tsx");
    // EGA-516: dashboard is now a compatibility redirect to the canonical Operator (Today)
    expect(dashboard).toContain('redirect("/today")');
    expect(dashboard).not.toContain("CommandCenterAsync");
    expect(dashboard).not.toContain("getDashboardData");
  });

  it("turns the dashboard into an editorial control board without replacing panels", () => {
    const css = read("src/app/dashboard/_components/dashboard-editorial.css");
    // Dashboard page is now a redirect, but editorial CSS remains for future Operator theming
    expect(css).toContain('[data-workspace-theme="editorial"] .ega-dashboard-hero');
    expect(css).toContain('[data-workspace-theme="editorial"] .workspace-main-rail-grid');
    expect(css).toContain('[data-workspace-theme="editorial"] .ega-dashboard-metric');
    expect(css).toContain('[data-workspace-theme="editorial"] .mcp-launch-console');
    expect(css).toContain("DASHBOARD / CONTROL BOARD");
    expect(css).toContain("@media (max-width: 1024px)");
    expect(css).toContain("@media (max-width: 640px)");
  });
});
