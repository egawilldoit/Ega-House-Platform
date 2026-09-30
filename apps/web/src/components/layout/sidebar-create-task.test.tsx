import { readFileSync } from "node:fs";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUICK_TASK_EVENT } from "@/lib/workspace-events";

import { SidebarCreateButton } from "./sidebar-create-button";

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

function readSource(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

describe("SidebarCreateButton (Unified Create Flow)", () => {
  it("exposes an accessible Create action", async () => {
    await act(async () => root.render(<SidebarCreateButton />));

    const button = container.querySelector<HTMLButtonElement>('[data-testid="sidebar-create-button"]');
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.getAttribute("aria-label")).toBe("Create");
    expect(button?.getAttribute("title")).toBe("Create");
    expect(button?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button?.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+N Meta+Shift+N");
    expect(button?.textContent).toContain("Create");
    expect(button?.className).toContain("workspace-create-task-trigger");
  });

  it("dispatches the canonical quick-task event and does not mount its own task surface", async () => {
    const listener = vi.fn();
    window.addEventListener(QUICK_TASK_EVENT, listener);

    await act(async () => root.render(<SidebarCreateButton />));
    const button = container.querySelector<HTMLButtonElement>('[data-testid="sidebar-create-button"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(listener).toHaveBeenCalledTimes(1);
    // The action reuses the shell's single UnifiedCreateSheet; it mounts no second form/sheet.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-slot="sheet-trigger"]')).toBeNull();

    window.removeEventListener(QUICK_TASK_EVENT, listener);
  });

  it("uses the shared canonical quick-task event name", () => {
    expect(QUICK_TASK_EVENT).toBe("ega:open-quick-task");
  });
});

describe("workspace navigation owns a single unified create flow", () => {
  it("keeps the UnifiedCreateSheet controller at shell level and triggers elsewhere", () => {
    const sidebar = readSource("components", "layout", "sidebar.tsx");
    const drawer = readSource("components", "layout", "sidebar-mobile-drawer.tsx");
    const controllers = readSource("components", "layout", "global-quick-action-controllers.tsx");
    const createTask = readSource("components", "layout", "sidebar-create-button.tsx");

    // Exactly one controller tree mounts UnifiedCreateSheet.
    expect((controllers.match(/<UnifiedCreateSheet/g) ?? []).length).toBe(1);

    // Navigation surfaces render the single unified trigger.
    for (const source of [sidebar, drawer]) {
      expect(source).toContain("<SidebarCreateButton");
      expect(source).not.toContain("<QuickTaskSheet");
      expect(source).not.toContain("<InboxCaptureSheet");
    }

    // Create trigger itself never mounts a sheet or task form.
    expect(createTask).not.toContain("<UnifiedCreateSheet");
    expect(createTask).not.toContain("<QuickTaskSheet");
    expect(createTask).not.toContain("<Sheet");
  });
});
