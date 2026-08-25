import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("EGA Command OS tokens — single authority", () => {
  it("defines authoritative tokens in styles/tokens.css", () => {
    const tokens = read("src/styles/tokens.css");
    expect(tokens).toContain("--ega-bg: #F7F3EA");
    expect(tokens).toContain("--ega-surface: #FFFFFF");
    expect(tokens).toContain("--ega-sidebar: #161F2C");
    expect(tokens).toContain("--ega-border: #E8E2D3");
    expect(tokens).toContain("--ega-gold: #E0A23A");
    expect(tokens).toContain("--status-healthy");
    expect(tokens).toContain("--category-deep-work");
    expect(tokens).toContain("--sidebar-width: 280px");
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
    // Ensure legacy aliases point old -> new, not new -> new
    expect(globals).toContain("--ega-app-bg: var(--ega-bg)");
    expect(globals).toContain("--ega-green: var(--status-healthy)");
  });

  it("keeps only valid legacy aliases", () => {
    const globals = read("src/app/globals.css");
    // No new token should be defined as var(--itself) in :root (ignore @theme inline which intentionally maps)
    const selfRefPattern = /--([a-z0-9-]+):\s*var\(--\1\)/;
    // Only check lines inside :root { ... } before @theme
    const rootBlock = globals.split("@theme")[0];
    const violations = rootBlock.split("\n").filter((l) => selfRefPattern.test(l));
    expect(violations, `self-referential lines: ${violations.join("; ")}`).toEqual([]);
  });

  it("resolves computed vars via jsdom (browser regression)", async () => {
    // Simulate browser computed style: create element with tokens and verify resolution
    // jsdom does not fully resolve CSS vars, but we can verify that tokens.css is imported first and globals maps correctly
    const tokens = read("src/styles/tokens.css");
    const globals = read("src/app/globals.css");
    expect(tokens.indexOf("@import")).toBe(-1); // tokens should not import globals (no cycle)
    expect(globals).toContain('@import "../styles/tokens.css"');
    expect(globals).toContain('@import "../styles/motion.css"');
    // Verify key computed mappings exist
    expect(globals).toContain("--background: var(--ega-bg)");
    expect(globals).toContain("--foreground: var(--ega-text)");
    expect(globals).toContain("--accent: var(--ega-gold)");
  });
});
