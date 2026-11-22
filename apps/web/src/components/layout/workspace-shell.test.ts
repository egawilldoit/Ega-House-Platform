import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pathFor = (path: string) => resolve(root, path);
const read = (path: string) => readFileSync(pathFor(path), "utf8");

const cssRule = (css: string, selector: string) => {
  const selectorStart = css.indexOf(selector);
  if (selectorStart < 0) {
    throw new Error(`Missing CSS selector: ${selector}`);
  }

  const openingBrace = css.indexOf("{", selectorStart);
  const closingBrace = css.indexOf("}", openingBrace);
  if (openingBrace < 0 || closingBrace < 0) {
    throw new Error(`Incomplete CSS rule: ${selector}`);
  }

  return css.slice(openingBrace + 1, closingBrace);
};

const requiredShellFiles = [
  "src/styles/workspace.css",
  "src/components/layout/workspace-shell.tsx",
  "src/components/layout/shell-route-meta.ts",
  "src/components/layout/sidebar.tsx",
  "src/components/layout/sidebar-navigation.tsx",
  "src/components/layout/sidebar-mobile-drawer.tsx",
  "src/components/layout/workspace-search-trigger.tsx",
] as const;

describe("light workspace shell", () => {
  it("provides focused shared shell modules", () => {
    for (const file of requiredShellFiles) {
      expect(existsSync(pathFor(file)), `${file} should exist`).toBe(true);
    }
  });

  it("retires the editorial shell files and their route numbering", () => {
    expect(existsSync(pathFor("src/components/layout/editorial-shell.css"))).toBe(false);
    expect(
      existsSync(pathFor("src/components/layout/editorial-shell-responsive.css")),
    ).toBe(false);
    expect(existsSync(pathFor("src/components/layout/editorial-shell.test.ts"))).toBe(false);
  });

  it("defines the navigation routes once, without editorial route indexes", () => {
    const routeMeta = read("src/components/layout/shell-route-meta.ts");

    for (const [label, href] of [
      ["Today", "/today"],
      ["Tasks", "/tasks"],
      ["Projects", "/tasks/projects"],
      ["Money", "/money"],
      ["Review", "/review"],
      ["Backlog", "/backlog"],
      ["Archive", "/archive"],
      ["Notifications", "/notifications"],
      ["Startup", "/startup"],
      ["Apps", "/apps"],
      ["Agents", "/agents"],
      ["Help", "/help"],
      ["Settings", "/settings/account"],
    ]) {
      expect(routeMeta).toContain(`label: "${label}"`);
      expect(routeMeta).toContain(`href: "${href}"`);
    }

    expect(routeMeta).not.toContain("index:");
    expect(routeMeta).not.toContain("eyebrow:");
    expect(routeMeta).not.toContain('href: "/dashboard"');
    expect(routeMeta).toContain("getShellRouteMeta");
  });

  it("derives identity on the server and keeps one verification round trip", () => {
    const lib = read("src/lib/workspace-shell.ts");

    expect(lib).toContain("export const getSessionUser = cache(");
    expect(lib).toContain("export async function getShellIdentity");
    expect(lib).toContain("getSessionUser()");
  });

  it("keeps one search implementation wired to the canonical palette", () => {
    const trigger = read("src/components/layout/workspace-search-trigger.tsx");
    const sidebar = read("src/components/layout/sidebar.tsx");

    expect(trigger).toContain("COMMAND_PALETTE_EVENT");
    expect(trigger).not.toContain("searchWorkspaceAction");
    expect(sidebar).toContain("<WorkspaceSearchTrigger />");
  });

  it("defines a light, quiet surface contract with overlays-only shadows", () => {
    const css = read("src/styles/workspace.css");
    const tokens = read("src/styles/tokens.css");

    expect(tokens).toContain("--ega-bg: #f2f2f2");
    expect(tokens).toContain("--ega-surface: #ffffff");
    expect(tokens).toContain("--ega-text: #171717");
    expect(tokens).toContain("--ega-border: #e5e5e5");
    expect(tokens).toContain("--ega-focus-outline: 2px solid var(--ega-text)");
    expect(tokens).toContain("--ega-shadow-panel: none");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("overflow-x: clip");
    expect(tokens).toContain("@media (min-width: 761px) and (max-width: 1080px)");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("@media (max-width: 420px)");

    // Component rules stay in the components layer so token utilities can refine them.
    expect(css).toContain("@layer components");

    // No editorial residue in the authenticated shell stylesheet.
    expect(css).not.toContain("citrus");
    expect(css).not.toContain("cream");
    expect(css).not.toContain("#11110f");
    expect(css).not.toContain("backdrop-filter: blur");
  });

  it("keeps the workspace shell light, not black or cream", () => {
    const tokens = read("src/styles/tokens.css");

    expect(tokens).toContain("--ega-bg: #f2f2f2");
    expect(tokens).toContain("--ega-surface: #ffffff");
    expect(tokens).toContain("--ega-text: #171717");
    expect(tokens).toContain("--ega-data-blue");
    expect(tokens).toContain("--status-overdue");
    expect(tokens).not.toContain("#F7F3EA");
    expect(tokens).not.toContain("#161F2C");
    expect(tokens).not.toContain("#E0A23A");
  });

  it("keeps the project section scroll-contained so system navigation cannot be pushed off screen", () => {
    const css = read("src/styles/workspace.css");
    const projectListRule = cssRule(css, ".sidebar-project-list");
    const sectionRule = cssRule(css, ".sidebar-section,");

    expect(projectListRule).toContain("max-height: min(31dvh, 18rem);");
    expect(projectListRule).toContain("overflow-y: auto;");
    expect(projectListRule).toContain("overscroll-behavior: contain;");
    expect(sectionRule).toContain("display: flex;");
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.app-sidebar\s*\{[\s\S]*?display: none/);
  });

  it("supports explicit expanded and icon-rail sidebar states", () => {
    const css = read("src/styles/workspace.css");
    const sidebar = read("src/components/layout/sidebar.tsx");
    const shell = read("src/components/layout/workspace-shell.tsx");
    const navigation = read("src/components/layout/sidebar-navigation.tsx");
    const logout = read("src/components/layout/sidebar-logout.tsx");

    expect(css).toContain('.app-shell[data-collapsed="true"]');
    const collapsedCreateTrigger = cssRule(css, '.app-shell[data-collapsed="true"] .workspace-create-task-trigger');
    expect(collapsedCreateTrigger).toContain("justify-content: center");
    expect(collapsedCreateTrigger).toContain("padding-inline: 0");
    expect(collapsedCreateTrigger).toContain("gap: 0");
    const drawerCreateTrigger = cssRule(css, '.app-shell .workspace-drawer-panel .workspace-create-task-trigger');
    expect(drawerCreateTrigger).toContain("justify-content: flex-start");
    expect(drawerCreateTrigger).toContain("padding-inline: 12px");
    expect(drawerCreateTrigger).toContain("gap: 10px");
    expect(read("src/styles/tokens.css")).toContain("--sidebar-collapsed-width: 72px");
    expect(sidebar).toContain('data-collapsed={collapsed ? "true" : "false"}');
    expect(sidebar).toContain("compact={collapsed}");
    expect(shell).toContain("const [collapsed, setCollapsed] = useState(false)");
    expect(shell).toContain('data-collapsed={collapsed ? "true" : "false"}');
    expect(navigation).toContain("aria-label={route.label}");
    expect(navigation).toContain("aria-label={getProjectAccessibleLabel(project)}");
    expect(navigation).toContain("activeTaskCount");
    expect(logout).toContain('aria-label={isPending ? "Signing out" : "Logout"}');
    expect(logout).toContain("workspace-nav-label");
  });

  it("preserves the dashboard compatibility redirect", () => {
    const nextConfig = read("next.config.ts");
    expect(nextConfig).toContain('source: "/dashboard"');
    expect(nextConfig).toContain('destination: "/today"');
  });

  it("keeps marketing styling out of the authenticated shell", () => {
    const globals = read("src/app/globals.css");
    // Authenticated shell styling must not live in the marketing stylesheet.
    expect(globals).not.toContain("ega-dashboard-hero");
  });
});
