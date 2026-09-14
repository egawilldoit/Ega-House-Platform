import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
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

vi.mock("next/image", () => ({
  default: () => <span data-testid="mock-next-image" aria-hidden="true" />,
}));

vi.mock("./sidebar-logout", () => ({ SidebarLogout: () => null }));

// Faithful lightweight controllers: each listens for its canonical event and
// renders exactly one dialog when open. Mounting one of these twice would make
// the duplicate-owner defect observable.
vi.mock("@/components/tasks/quick-task-sheet", () => ({
  QuickTaskSheet: () => {
    const [open, setOpen] = useState(false);
    useEffect(() => {
      const handler = () => setOpen(true);
      window.addEventListener("ega:open-quick-task", handler);
      return () => window.removeEventListener("ega:open-quick-task", handler);
    }, []);
    return (
      <div data-testid="quick-task-controller">
        {open ? (
          <div role="dialog" aria-label="Quick task sheet">
            Quick task
          </div>
        ) : null}
      </div>
    );
  },
}));

vi.mock("@/components/inbox/inbox-capture-sheet", () => ({
  InboxCaptureSheet: () => {
    const [open, setOpen] = useState(false);
    useEffect(() => {
      const handler = () => setOpen(true);
      window.addEventListener("ega:open-inbox-capture", handler);
      return () => window.removeEventListener("ega:open-inbox-capture", handler);
    }, []);
    return (
      <div data-testid="inbox-capture-controller">
        {open ? (
          <div role="dialog" aria-label="Inbox capture sheet">
            Capture
          </div>
        ) : null}
      </div>
    );
  },
}));

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";
import { QUICK_TASK_EVENT, INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";

import { GlobalQuickActionControllers } from "./global-quick-action-controllers";
import { Sidebar } from "./sidebar";
import { SidebarMobileDrawer } from "./sidebar-mobile-drawer";

const metrics = buildWorkspaceShellMetrics({
  hasActiveTimer: false,
  blockedTaskCount: 0,
  overdueTaskCount: 0,
  dueTodayTaskCount: 0,
  hasCurrentWeekReview: true,
});

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
  document.body.style.overflow = "";
});

async function renderShell() {
  await act(async () => {
    root.render(
      <>
        <GlobalQuickActionControllers projects={[]} goals={[]} />
        <Sidebar projects={[]} metrics={metrics} />
        <SidebarMobileDrawer projects={[]} metrics={metrics} />
      </>,
    );
  });
}

function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function dispatchEvent(name: string) {
  return act(async () => {
    window.dispatchEvent(new CustomEvent(name));
  });
}

function drawerTrigger() {
  return container.querySelector<HTMLButtonElement>('button[aria-label="Open workspace navigation"]')!;
}

function drawerPanel() {
  return container.querySelector('[role="dialog"][aria-label="Workspace navigation"]');
}

describe("EGA-649 single global quick-action ownership", () => {
  it("mounts exactly one Inbox Capture and one Quick Task controller at shell level", async () => {
    await renderShell();
    expect(container.querySelectorAll('[data-testid="quick-task-controller"]').length).toBe(1);
    expect(container.querySelectorAll('[data-testid="inbox-capture-controller"]').length).toBe(1);

    // Opening the mobile drawer must not mount another controller.
    await click(drawerTrigger());
    expect(drawerPanel()).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="quick-task-controller"]').length).toBe(1);
    expect(container.querySelectorAll('[data-testid="inbox-capture-controller"]').length).toBe(1);
  });

  it("drawer closed: the quick-task event opens exactly one surface", async () => {
    await renderShell();
    await dispatchEvent(QUICK_TASK_EVENT);
    expect(container.querySelectorAll('[role="dialog"][aria-label="Quick task sheet"]').length).toBe(1);
  });

  it("drawer open -> Create Task closes the drawer and opens exactly one task surface", async () => {
    await renderShell();
    await click(drawerTrigger());
    const createTask = drawerPanel()!.querySelector('[data-testid="sidebar-create-task"]')!;
    await click(createTask);

    expect(drawerPanel()).toBeNull();
    expect(container.querySelectorAll('[data-testid="quick-task-controller"]').length).toBe(1);
    expect(container.querySelectorAll('[role="dialog"][aria-label="Quick task sheet"]').length).toBe(1);
    // No second modal layer remains.
    expect(container.querySelectorAll('[role="dialog"][aria-label="Workspace navigation"]').length).toBe(0);
    expect(document.body.style.overflow).toBe("");
  });

  it("drawer open -> Capture closes the drawer and opens exactly one capture surface", async () => {
    await renderShell();
    await click(drawerTrigger());
    const capture = drawerPanel()!.querySelector('[data-testid="inbox-quick-capture-trigger"]')!;
    await click(capture);

    expect(drawerPanel()).toBeNull();
    expect(container.querySelectorAll('[data-testid="inbox-capture-controller"]').length).toBe(1);
    expect(container.querySelectorAll('[role="dialog"][aria-label="Inbox capture sheet"]').length).toBe(1);
    expect(container.querySelectorAll('[role="dialog"][aria-label="Workspace navigation"]').length).toBe(0);
    expect(document.body.style.overflow).toBe("");
  });

  it("a single event dispatch (shortcut/Home quick action) never opens more than one surface", async () => {
    await renderShell();
    await dispatchEvent(INBOX_CAPTURE_EVENT);
    expect(container.querySelectorAll('[role="dialog"][aria-label="Inbox capture sheet"]').length).toBe(1);
    await dispatchEvent(QUICK_TASK_EVENT);
    expect(container.querySelectorAll('[role="dialog"][aria-label="Quick task sheet"]').length).toBe(1);
  });

  it("EGA-654: icon-only quick actions keep accessible names and tooltips", async () => {
    await renderShell();

    const capture = container.querySelector('[data-testid="inbox-quick-capture-trigger"]');
    expect(capture?.getAttribute("aria-label")).toBe("Capture to Inbox");
    expect(capture?.getAttribute("title")).toBe("Capture to Inbox");

    const createTask = container.querySelector('[data-testid="sidebar-create-task"]');
    expect(createTask?.getAttribute("aria-label")).toBe("Create task");
    expect(createTask?.getAttribute("title")).toBe("Create task");
  });

  it("Escape still closes the drawer and restores the trigger", async () => {
    await renderShell();
    const trigger = drawerTrigger();
    trigger.focus();
    await click(trigger);
    expect(drawerPanel()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(drawerPanel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
