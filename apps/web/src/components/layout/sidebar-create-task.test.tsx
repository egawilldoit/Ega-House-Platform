import { readFileSync } from "node:fs";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUICK_TASK_EVENT } from "@/lib/workspace-events";

import { SidebarCreateTaskButton } from "./sidebar-create-task";

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

describe("SidebarCreateTaskButton (EGA-649)", () => {
  it("exposes an accessible Create task action", async () => {
    await act(async () => root.render(<SidebarCreateTaskButton />));

    const button = container.querySelector<HTMLButtonElement>('[data-testid="sidebar-create-task"]');
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.getAttribute("aria-label")).toBe("Create task");
    expect(button?.getAttribute("title")).toBe("Create task");
    expect(button?.textContent).toContain("Create task");
  });

  it("dispatches the canonical quick-task event and does not mount its own task surface", async () => {
    const listener = vi.fn();
    window.addEventListener(QUICK_TASK_EVENT, listener);

    await act(async () => root.render(<SidebarCreateTaskButton />));
    const button = container.querySelector<HTMLButtonElement>('[data-testid="sidebar-create-task"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(listener).toHaveBeenCalledTimes(1);
    // The action reuses the shell's single QuickTaskSheet; it mounts no second form/sheet.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-slot="sheet-trigger"]')).toBeNull();

    window.removeEventListener(QUICK_TASK_EVENT, listener);
  });

  it("uses the shared canonical quick-task event name", () => {
    expect(QUICK_TASK_EVENT).toBe("ega:open-quick-task");
  });
});

describe("workspace navigation owns a single quick-task flow (EGA-649)", () => {
  it("mounts InboxQuickCapture and the Create Task action without a duplicate task sheet", () => {
    const sidebar = readSource("components", "layout", "sidebar.tsx");
    const drawer = readSource("components", "layout", "sidebar-mobile-drawer.tsx");
    const capture = readSource("components", "inbox", "inbox-quick-capture.tsx");
    const createTask = readSource("components", "layout", "sidebar-create-task.tsx");

    expect((sidebar.match(/<InboxQuickCapture/g) ?? []).length).toBe(1);
    expect((drawer.match(/<InboxQuickCapture/g) ?? []).length).toBe(1);
    expect(sidebar).toContain("<SidebarCreateTaskButton");
    expect(drawer).toContain("<SidebarCreateTaskButton");

    // Exactly one canonical QuickTaskSheet exists in the shell flow, owned by capture.
    expect((capture.match(/<QuickTaskSheet/g) ?? []).length).toBe(1);

    // Create Task must not create a second sheet or task form.
    expect(createTask).not.toContain("<QuickTaskSheet");
    expect(createTask).not.toContain("<Sheet");

    // Capture still opens the Inbox capture sheet.
    expect(capture).toContain("INBOX_CAPTURE_EVENT");
    expect(capture).toContain('data-testid="inbox-quick-capture-trigger"');
  });
});
