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

// Faithful lightweight controller: listens for creation events and renders
// exactly one dialog when open. Mounting this twice would make the duplicate-owner
// defect observable.
vi.mock("@/components/create/unified-create-sheet", () => ({
  UnifiedCreateSheet: () => {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<"task" | "backlog">("task");

    useEffect(() => {
      const handleTask = () => {
        setMode("task");
        setOpen(true);
      };
      const handleBacklog = () => {
        setMode("backlog");
        setOpen(true);
      };
      window.addEventListener("ega:open-quick-task", handleTask);
      window.addEventListener("ega:open-inbox-capture", handleBacklog);
      return () => {
        window.removeEventListener("ega:open-quick-task", handleTask);
        window.removeEventListener("ega:open-inbox-capture", handleBacklog);
      };
    }, []);

    return (
      <div data-testid="unified-create-controller">
        {open ? (
          <div role="dialog" aria-label={`Unified create modal: ${mode}`}>
            {mode === "task" ? "Create task" : "Backlog capture"}
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

describe("single global quick-action ownership (Unified Create Flow)", () => {
  it("mounts exactly one Unified Create controller at shell level", async () => {
    await renderShell();
    expect(container.querySelectorAll('[data-testid="unified-create-controller"]').length).toBe(1);

    // Opening the mobile drawer must not mount another controller.
    await click(drawerTrigger());
    expect(drawerPanel()).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="unified-create-controller"]').length).toBe(1);
  });

  it("drawer closed: the quick-task event opens exactly one surface (task mode)", async () => {
    await renderShell();
    await dispatchEvent(QUICK_TASK_EVENT);
    expect(
      container.querySelectorAll('[role="dialog"][aria-label="Unified create modal: task"]').length,
    ).toBe(1);
  });

  it("drawer closed: the inbox-capture event opens exactly one surface (backlog mode)", async () => {
    await renderShell();
    await dispatchEvent(INBOX_CAPTURE_EVENT);
    expect(
      container.querySelectorAll('[role="dialog"][aria-label="Unified create modal: backlog"]').length,
    ).toBe(1);
  });

  it("drawer open -> Create closes the drawer and opens exactly one creation surface", async () => {
    await renderShell();
    await click(drawerTrigger());
    const createButton = drawerPanel()!.querySelector('[data-testid="sidebar-create-button"]')!;
    await click(createButton);

    expect(drawerPanel()).toBeNull();
    expect(container.querySelectorAll('[data-testid="unified-create-controller"]').length).toBe(1);
    expect(
      container.querySelectorAll('[role="dialog"][aria-label="Unified create modal: task"]').length,
    ).toBe(1);
    // No second modal layer remains.
    expect(container.querySelectorAll('[role="dialog"][aria-label="Workspace navigation"]').length).toBe(0);
    expect(document.body.style.overflow).toBe("");
  });

  it("a single event dispatch (shortcut/Home quick action) never opens more than one surface", async () => {
    await renderShell();
    await dispatchEvent(INBOX_CAPTURE_EVENT);
    expect(
      container.querySelectorAll('[role="dialog"][aria-label="Unified create modal: backlog"]').length,
    ).toBe(1);
    await dispatchEvent(QUICK_TASK_EVENT);
    expect(
      container.querySelectorAll('[role="dialog"][aria-label="Unified create modal: task"]').length,
    ).toBe(1);
  });

  it("quick action keeps accessible name and tooltip", async () => {
    await renderShell();

    const createButton = container.querySelector('[data-testid="sidebar-create-button"]');
    expect(createButton?.getAttribute("aria-label")).toBe("Create");
    expect(createButton?.getAttribute("title")).toBe("Create");
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
