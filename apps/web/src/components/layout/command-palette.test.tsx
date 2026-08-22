import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette, COMMAND_PALETTE_EVENT } from "./command-palette";

const searchWorkspaceAction = vi.fn();
const routerPush = vi.fn();

vi.mock("@/app/search/actions", () => ({
  searchWorkspaceAction: (query: string) => searchWorkspaceAction(query),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("./command-palette-model", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  filterNavigationItems: (query: string) =>
    query.trim() === ""
      ? [{ id: "nav-tasks", group: "go-to", label: "Tasks", hint: null, href: "/tasks" }]
      : [],
  buildWorkspaceSections: (result: { query: string; tasks: Array<{ id: string }> }) => [
    {
      id: "tasks",
      title: "Tasks",
      items: result.tasks.map((task) => ({
        id: `task-${task.id}`,
        group: "tasks",
        label: `Task ${task.id}`,
        hint: null,
        href: `/tasks#task-${task.id}`,
      })),
    },
  ],
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  searchWorkspaceAction.mockReset();
  searchWorkspaceAction.mockResolvedValue({ query: "", tasks: [], projects: [], goals: [] });
  routerPush.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.style.overflow = "";
});

async function renderPalette() {
  await act(async () => {
    root.render(<CommandPalette />);
  });
}

async function openViaShortcut() {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT));
  });
}

const dialog = () => document.body.querySelector('[role="dialog"]');
const input = () => document.body.querySelector<HTMLInputElement>('input[role="combobox"]');

describe("CommandPalette", () => {
  it("stays closed until the shortcut event fires", async () => {
    await renderPalette();
    expect(dialog()).toBeNull();

    await openViaShortcut();

    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it("shows navigation entries for an empty query and navigates on Enter", async () => {
    await renderPalette();
    await openViaShortcut();

    const options = document.body.querySelectorAll('[role="option"]');
    expect(options.length).toBe(1);
    expect(options[0].getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      input()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(routerPush).toHaveBeenCalledWith("/tasks");
    expect(dialog()).toBeNull();
  });

  it("debounces queries into a server action and renders grouped results", async () => {
    vi.useFakeTimers();
    try {
      searchWorkspaceAction.mockResolvedValue({
        query: "landing",
        tasks: [{ id: "t1", title: "Ship landing page", status: "todo", projectName: "Web" }],
        projects: [],
        goals: [],
      });

      await renderPalette();
      await openViaShortcut();

      await act(async () => {
        input()?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const inputElement = input();
      if (inputElement) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(inputElement, "landing");
        inputElement.dispatchEvent(new Event("input", { bubbles: true }));
      }

      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      await act(async () => {});

      expect(searchWorkspaceAction).toHaveBeenCalledWith("landing");

      const options = document.body.querySelectorAll('[role="option"]');
      expect(options.length).toBe(1);
      expect(options[0].textContent).toContain("Task t1");
      expect(options[0].id).toMatch(/option-0$/);
      expect(input()?.getAttribute("aria-activedescendant")).toBe(options[0].id);
    } finally {
      vi.useRealTimers();
    }
  });
});
