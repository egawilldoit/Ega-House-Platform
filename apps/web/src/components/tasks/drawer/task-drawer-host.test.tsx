// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh }),
  usePathname: () => "/tasks",
  useSearchParams: () => currentParams,
}));

import { TaskDrawerHost } from "./task-drawer-host";

const TASK = {
  id: "t1",
  title: "Draft weekly execution review",
  status: "in_progress",
  priority: "high",
  due_date: "2026-05-01",
  project_id: "p1",
  goal_id: "g1",
  archived_at: null as string | null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockClear();
  replace.mockClear();
  currentParams = new URLSearchParams();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const updateFieldAction = vi.fn();

function render(task: typeof TASK | null, loadFailed = false) {
  act(() =>
    root.render(
      <TaskDrawerHost
        task={task}
        loadFailed={loadFailed}
        updateFieldAction={updateFieldAction}
      />,
    ),
  );
}

describe("TaskDrawerHost", () => {
  it("renders nothing when no task is selected in the URL", () => {
    render(TASK);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the selected task with its status, priority and due date", () => {
    currentParams = new URLSearchParams("task=t1&layout=board");
    render(TASK);

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Draft weekly execution review");

    const selects = Array.from(document.body.querySelectorAll<HTMLSelectElement>("select"));
    // Status and priority are inline editors now; assert the bound values.
    expect(selects.map((select) => select.value)).toEqual(["in_progress", "high"]);
    const dueDate = document.body.querySelector<HTMLInputElement>('input[type="date"]');
    expect(dueDate?.value).toBe("2026-05-01");
  });

  it("shows an indistinguishable unavailable state for a missing task", () => {
    currentParams = new URLSearchParams("task=missing-id");
    render(null);

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Task unavailable");
    expect(dialog?.textContent).toContain("may have been deleted");
  });

  it("reports an operational failure distinctly from a missing task", () => {
    currentParams = new URLSearchParams("task=t1");
    render(null, true);

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Unable to load this task right now.");
    expect(dialog?.textContent).not.toContain("may have been deleted");

    const retry = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    );
    act(() => {
      (retry as HTMLButtonElement).click();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("submits a single-field patch for the inline property editors", () => {
    currentParams = new URLSearchParams("task=t1&layout=board");
    render(TASK);

    const statusSelect = document.body.querySelector<HTMLSelectElement>('select[name="value"]');
    expect(statusSelect).not.toBeNull();
    const form = statusSelect?.form as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(form.querySelector<HTMLInputElement>('input[name="field"]')?.value).toBe("status");
    expect(form.querySelector<HTMLInputElement>('input[name="taskId"]')?.value).toBe("t1");
    expect(form.querySelector<HTMLInputElement>('input[name="returnTo"]')?.value).toContain(
      "task=t1",
    );
  });

  it("closes by removing only the drawer parameters", () => {
    currentParams = new URLSearchParams("task=t1&layout=board&sort=due");
    render(TASK);

    const close = document.body.querySelector('[aria-label="Close task details"]');
    act(() => {
      (close as HTMLButtonElement).click();
    });

    expect(replace).toHaveBeenCalledTimes(1);
    const href = replace.mock.calls[0][0] as string;
    expect(href.startsWith("/tasks?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.has("task")).toBe(false);
    expect(params.get("layout")).toBe("board");
    expect(params.get("sort")).toBe("due");
  });
});
