import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUICK_TASK_EVENT, INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";
import { UnifiedCreateSheet, UNIFIED_CREATE_EVENT } from "./unified-create-sheet";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/home",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/tasks/actions", () => ({
  createTaskAction: vi.fn(),
  createTasksBulkAction: vi.fn(),
}));

vi.mock("@/components/inbox/capture-action", () => ({
  captureInboxIdea: vi.fn().mockResolvedValue({ ok: true }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function changeInput(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("UnifiedCreateSheet", () => {
  const mockProjects = [
    { id: "proj-1", name: "Core Platform" },
    { id: "proj-2", name: "Growth" },
  ];
  const mockGoals = [{ id: "goal-1", title: "Ship V1", project_id: "proj-1" }];

  async function renderSheet() {
    await act(async () => {
      root.render(<UnifiedCreateSheet projects={mockProjects} goals={mockGoals} />);
    });
  }

  function dispatch(name: string, detail?: unknown) {
    return act(async () => {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    });
  }

  function click(element: Element) {
    return act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("opens in Task mode upon QUICK_TASK_EVENT", async () => {
    await renderSheet();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await dispatch(QUICK_TASK_EVENT);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    const taskTab = document.querySelector('[data-testid="create-tab-task"]');
    const backlogTab = document.querySelector('[data-testid="create-tab-backlog"]');

    expect(taskTab?.getAttribute("aria-selected")).toBe("true");
    expect(backlogTab?.getAttribute("aria-selected")).toBe("false");

    // Task command input is rendered
    expect(document.getElementById("quick-task-command")).not.toBeNull();
  });

  it("opens in Backlog mode upon INBOX_CAPTURE_EVENT", async () => {
    await renderSheet();
    await dispatch(INBOX_CAPTURE_EVENT);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    const taskTab = document.querySelector('[data-testid="create-tab-task"]');
    const backlogTab = document.querySelector('[data-testid="create-tab-backlog"]');

    expect(taskTab?.getAttribute("aria-selected")).toBe("false");
    expect(backlogTab?.getAttribute("aria-selected")).toBe("true");

    // Backlog idea input is rendered
    expect(document.getElementById("inbox-capture-title")).not.toBeNull();
  });

  it("preserves typed title when switching between Task and Backlog tabs", async () => {
    await renderSheet();
    await dispatch(QUICK_TASK_EVENT);

    // Enter a command / title in Task mode
    const taskInput = document.getElementById("quick-task-command") as HTMLInputElement;
    expect(taskInput).not.toBeNull();

    await act(async () => {
      changeInput(taskInput, "Refactor database migrations");
    });
    expect(taskInput.value).toBe("Refactor database migrations");

    // Switch to Backlog mode
    const backlogTab = document.querySelector('[data-testid="create-tab-backlog"]')!;
    await click(backlogTab);

    expect(backlogTab.getAttribute("aria-selected")).toBe("true");

    // The Backlog idea input must carry over the entered title!
    const ideaInput = document.getElementById("inbox-capture-title") as HTMLInputElement;
    expect(ideaInput).not.toBeNull();
    expect(ideaInput.value).toBe("Refactor database migrations");

    // Modify title in Backlog mode
    await act(async () => {
      changeInput(ideaInput, "Updated idea title");
    });

    // Switch back to Task mode
    const taskTab = document.querySelector('[data-testid="create-tab-task"]')!;
    await click(taskTab);

    // The Task command input must reflect the updated title!
    const updatedTaskInput = document.getElementById("quick-task-command") as HTMLInputElement;
    expect(updatedTaskInput.value).toBe("Updated idea title");
  });

  it("can be triggered with UNIFIED_CREATE_EVENT specifying mode", async () => {
    await renderSheet();
    await dispatch(UNIFIED_CREATE_EVENT, { mode: "backlog" });

    expect(
      document.querySelector('[data-testid="create-tab-backlog"]')?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("isolates project selection state between Task and Backlog modes", async () => {
    await renderSheet();
    await dispatch(QUICK_TASK_EVENT);

    // In Task mode
    const taskTab = document.querySelector('[data-testid="create-tab-task"]');
    expect(taskTab?.getAttribute("aria-selected")).toBe("true");

    // Switch to Backlog mode
    const backlogTab = document.querySelector('[data-testid="create-tab-backlog"]')!;
    await click(backlogTab);
    expect(backlogTab.getAttribute("aria-selected")).toBe("true");

    // Switch back to Task mode
    await click(taskTab!);
    expect(taskTab?.getAttribute("aria-selected")).toBe("true");
  });

  it("closes modal on close button click", async () => {
    await renderSheet();
    await dispatch(QUICK_TASK_EVENT);

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    const closeBtn = document.querySelector('button[aria-label="Close create dialog"]')!;
    expect(closeBtn).not.toBeNull();

    await click(closeBtn);

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
