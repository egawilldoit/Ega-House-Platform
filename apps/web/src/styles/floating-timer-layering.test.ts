import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceCss = readFileSync(
  resolve(process.cwd(), "src/styles/workspace.css"),
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
    const mobileDrawerOverlay = zIndexFor(".workspace-drawer-overlay");
    const mobileDrawerPanel = zIndexFor(".workspace-drawer-panel");

    expect(chip).toBeGreaterThan(sidebar);
    expect(chip).toBeLessThan(desktopDrawerOverlay);
    expect(chip).toBeLessThan(mobileDrawerOverlay);
    expect(chip).toBeLessThan(mobileDrawerPanel);
  });
});
