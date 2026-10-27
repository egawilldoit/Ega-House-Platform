import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("EGA House workspace tokens — single authority", () => {
  it("defines the light workspace token authority in styles/tokens.css", () => {
    const tokens = read("src/styles/tokens.css");

    expect(tokens).toContain("--ega-bg: #f2f2f2");
    expect(tokens).toContain("--ega-surface: #ffffff");
    expect(tokens).toContain("--ega-surface-subtle: #fafafa");
    expect(tokens).toContain("--ega-surface-hover: #f5f5f5");
    expect(tokens).toContain("--ega-border: #e5e5e5");
    expect(tokens).toContain("--ega-border-strong: #d6d6d6");
    expect(tokens).toContain("--ega-text: #171717");
    expect(tokens).toContain("--ega-text-secondary: #5c5c5c");
    expect(tokens).toContain("--ega-text-tertiary: #6a6a6a");

    // Data categories and status semantics stay separate namespaces.
    expect(tokens).toContain("--ega-data-blue");
    expect(tokens).toContain("--ega-data-orange");
    expect(tokens).toContain("--ega-data-yellow");
    expect(tokens).toContain("--ega-data-green");
    expect(tokens).toContain("--ega-data-purple");
    expect(tokens).toContain("--ega-data-slate");
    expect(tokens).toContain("--status-healthy");
    expect(tokens).toContain("--status-risk");
    expect(tokens).toContain("--status-overdue");

    // Shell geometry
    expect(tokens).toContain("--sidebar-width: 264px");
    expect(tokens).toContain("--sidebar-collapsed-width: 72px");
    expect(tokens).toContain("--topbar-height: 56px");
  });

  it("retires the cream, dark-sidebar, and gold editorial assumptions", () => {
    const tokens = read("src/styles/tokens.css");

    expect(tokens).not.toContain("#F7F3EA");
    expect(tokens).not.toContain("#161F2C");
    expect(tokens).not.toContain("#E0A23A");
    expect(tokens).not.toContain("#E8E2D3");
    expect(tokens).not.toContain("--category-deep-work");
  });

  it("defines the scoped dark workspace palette without a second authority", () => {
    const tokens = read("src/styles/tokens.css");

    expect(tokens).toContain(
      'html[data-theme="dark"]:has([data-workspace-theme="workspace"])',
    );
    expect(tokens).toContain("--ega-bg: #101114");
    expect(tokens).toContain("--ega-surface: #17181d");
    expect(tokens).toContain("--ega-surface-subtle: #1c1e24");
    expect(tokens).toContain("--ega-surface-hover: #21232a");
    expect(tokens).toContain("--ega-border: #2c2f37");
    expect(tokens).toContain("--ega-border-strong: #3a3e48");
    expect(tokens).toContain("--ega-control-border: #6b7280");
    expect(tokens).toContain("--ega-text: #f2f3f5");
    expect(tokens).toContain("--ega-text-secondary: #b4b8c1");
    expect(tokens).toContain("--ega-text-tertiary: #9196a1");
    expect(tokens).toContain("--ega-on-ink: #101114");

    // Dark status and data namespaces remain separate.
    expect(tokens).toContain("--status-healthy: #4ade80");
    expect(tokens).toContain("--status-overdue: #f87171");
    expect(tokens).toContain("--ega-data-blue: #60a5fa");
    expect(tokens).toContain("--ega-data-green: #4ade80");
  });

  it("keeps the public marketing and auth stylesheets outside the workspace theme", () => {
    const tokens = read("src/styles/tokens.css");
    const marketing = read("src/app/home/home.css");
    const auth = read("src/app/auth-ui/auth.css");

    // `:has()` is the isolation boundary: without the authenticated marker the
    // dark tokens never resolve, regardless of the document data-theme.
    expect(tokens).toContain(':has([data-workspace-theme="workspace"])');
    expect(marketing).toContain("@media (prefers-color-scheme: dark)");
    expect(marketing).toContain("--home-bg");
    expect(auth).toContain("@media (prefers-color-scheme: dark)");
    expect(auth).toContain('--auth-bg');
    expect(tokens).not.toContain("--home-bg");
    expect(tokens).not.toContain("--auth-bg");
  });

  it("does not contain self-referential cycles in globals.css", () => {
    const globals = read("src/app/globals.css");
    const selfRefs = [
      "--ega-bg: var(--ega-bg)",
      "--ega-text: var(--ega-text)",
      "--ega-border-subtle: var(--ega-border-subtle)",
      "--sidebar-width: var(--sidebar-width)",
    ];
    for (const cycle of selfRefs) {
      expect(globals).not.toContain(cycle);
    }
    // Legacy aliases point old -> new, never new -> new
    expect(globals).toContain("--background: var(--ega-bg)");
    expect(globals).toContain("--signal-live: var(--status-healthy)");
  });

  it("keeps only valid legacy aliases", () => {
    const globals = read("src/app/globals.css");
    // No token may be defined as var(--itself) in :root (@theme inline maps on purpose)
    const selfRefPattern = /--([a-z0-9-]+):\s*var\(--\1\)/;
    const rootBlock = globals.split("@theme")[0];
    const violations = rootBlock.split("\n").filter((l) => selfRefPattern.test(l));
    expect(violations, `self-referential lines: ${violations.join("; ")}`).toEqual([]);
  });

  it("defines the drag shadow in both palettes", () => {
    const tokens = read("src/styles/tokens.css");
    // Light :root block and the scoped dark block must both carry the token, so
    // a dragged surface never falls back to an undefined shadow.
    const occurrences = tokens.match(/--ega-shadow-drag:/g) ?? [];
    expect(occurrences).toHaveLength(2);
    expect(tokens).toContain("--ega-shadow-drag: 0 18px 36px");
  });

  it("resolves computed vars via jsdom (browser regression)", async () => {
    const tokens = read("src/styles/tokens.css");
    const globals = read("src/app/globals.css");
    expect(tokens.indexOf("@import")).toBe(-1); // tokens must not import globals (no cycle)
    expect(globals).toContain('@import "../styles/tokens.css"');
    expect(globals).toContain('@import "../styles/motion.css"');
    // Key computed mappings exist and resolve to the light workspace tokens
    expect(globals).toContain("--background: var(--ega-bg)");
    expect(globals).toContain("--foreground: var(--ega-text)");
    expect(globals).toContain("--accent: var(--ega-ink)");
    expect(globals).toContain("--color-ega-surface: var(--ega-surface)");
  });
});
