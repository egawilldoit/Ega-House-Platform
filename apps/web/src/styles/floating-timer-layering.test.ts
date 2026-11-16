import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceCss = readFileSync(
  resolve(process.cwd(), "src/styles/workspace.css"),
  "utf8",
);
const preferencesCss = readFileSync(
  resolve(
    process.cwd(),
    "src/app/(workspace)/settings/preferences/preferences.module.css",
  ),
  "utf8",
);
const preferencesForm = readFileSync(
  resolve(
    process.cwd(),
    "src/app/(workspace)/settings/preferences/personal-operations-form.tsx",
  ),
  "utf8",
);

function zIndexFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `${escaped}\\s*\\{[\\s\\S]*?z-index:\\s*(\\d+)`,
  ).exec(workspaceCss);
  expect(match, `missing z-index for ${selector}`).not.toBeNull();
  return Number(match?.[1]);
}

describe("floating timer layering", () => {
  it("sits above persistent shell chrome but below modal drawers and dialogs", () => {
    const chip = zIndexFor(".ega-timer-chip");
    const sidebar = zIndexFor(".app-sidebar");
    const desktopDrawerOverlay = 40;
    const mobileDrawerLayer = zIndexFor(".workspace-drawer-layer");
    const mobileDrawerPanel = zIndexFor(".workspace-drawer-panel");

    expect(chip).toBeGreaterThan(sidebar);
    expect(chip).toBeLessThan(desktopDrawerOverlay);
    expect(chip).toBeLessThan(mobileDrawerLayer);
    expect(chip).toBeLessThan(mobileDrawerPanel);
  });

  it("lifts the chip clear of the z-45 preferences save bar instead of covering it", () => {
    expect(preferencesCss).toMatch(/\.saveBar\s*\{[\s\S]*?z-index:\s*45/);
    expect(preferencesForm).toContain('data-ega-save-bar');
    expect(workspaceCss).toMatch(
      /body:has\(\[data-ega-save-bar\]\) \.ega-timer-chip\s*\{[\s\S]*?bottom:\s*calc\(116px/,
    );
  });

  it("keeps the Quick Notes panel above shell chrome and below modal overlays", () => {
    const panel = zIndexFor(".ega-quick-notes-panel");
    const sidebar = zIndexFor(".app-sidebar");
    const topbar = zIndexFor(".app-topbar");

    // The top bar is a lower stacking context than the sidebar, which is why
    // the fixed panel must be mounted outside the shell rather than in the
    // top-bar slot that holds its entry button.
    expect(topbar).toBeLessThan(sidebar);
    expect(panel).toBeGreaterThan(sidebar);
    expect(panel).toBeLessThan(40);
  });
});
