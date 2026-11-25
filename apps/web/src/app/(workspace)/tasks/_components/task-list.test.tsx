// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll: _scroll,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    scroll?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/tasks/task-due-date-label", () => ({
  TaskDueDateLabel: ({ dueDate }: { dueDate: string | null }) =>
    dueDate ? <span>Due {dueDate}</span> : null,
}));

import type { BulkTaskResult } from "@/lib/services/task-bulk-service";
import type { TaskRecord } from "@/lib/services/task-service";
import { TaskList } from "./task-list";

function buildTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    title: "Draft weekly execution review",
    description: "Summarize the week.",
    blocked_reason: null,
    status: "todo",
    priority: "high",
    due_date: "2026-05-01",
    planned_for_date: null,
    start_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    estimate_minutes: 60,
    updated_at: "2026-04-28T10:00:00.000Z",
    completed_at: null,
    project_id: "project-1",
    goal_id: null,
    focus_rank: null,
    board_rank: null,
    archived_at: null,
    archived_by: null,
    projects: { name: "EGA House" },
    goals: null,
    task_reminders: [],
    task_recurrences: [],
    ...overrides,
  };
}

function applied(field: BulkTaskResult["field"]): BulkTaskResult {
  return {
    operationId: null,
    field,
    applied: 1,
    results: [],
    undoable: false,
    errorMessage: null,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  push.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(
  tasks: TaskRecord[],
  {
    view = "active" as "active" | "archived",
    bulkFieldAction = vi.fn(async () => applied("status")),
    bulkArchiveAction = vi.fn(async () => applied("archive")),
    unarchiveAction = vi.fn(),
  } = {},
) {
  await act(async () => {
    root.render(
      <TaskList
        tasks={tasks}
        returnTo="/tasks?view=active"
        view={view}
        bulkActions={{ bulkFieldAction, bulkArchiveAction }}
        unarchiveAction={unarchiveAction}
      />,
    );
  });
  return { bulkFieldAction, bulkArchiveAction, unarchiveAction };
}

function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("TaskList", () => {
  it("renders a semantic list with title, project badge, due date and priority", async () => {
    await render([buildTask()]);

    const list = container.querySelector('ul[aria-label="Tasks"]');
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll("li[data-task-row]").length).toBe(1);
    expect(container.textContent).toContain("Draft weekly execution review");
    expect(container.textContent).toContain("EGA House");
    expect(container.textContent).toContain("2026-05-01");
    expect(container.textContent).toContain("High");
  });

  it("completes a task from its status checkbox", async () => {
    const { bulkFieldAction } = await render([buildTask()]);

    await click(container.querySelector('[data-testid="task-status-task-1"]')!);

    expect(bulkFieldAction).toHaveBeenCalledWith({
      taskIds: ["task-1"],
      field: "status",
      value: "done",
      returnTo: "/tasks?view=active",
    });
  });

  it("shows a rejected completion checkbox action even with no rows selected", async () => {
    const denied: BulkTaskResult = {
      operationId: null,
      field: "status",
      applied: 0,
      results: [{ taskId: "task-1", outcome: "error", message: "Not allowed" }],
      undoable: false,
      errorMessage: "You cannot complete this task.",
    };
    await render([buildTask()], {
      bulkFieldAction: vi.fn(async () => denied),
    });

    expect(container.querySelector('[data-testid="task-list-message"]')).toBeNull();

    await click(container.querySelector('[data-testid="task-status-task-1"]')!);

    expect(container.querySelector('[data-testid="task-list-message"]')?.textContent).toContain(
      "You cannot complete this task.",
    );
    expect(container.querySelector('[aria-label="Bulk task actions"]')).toBeNull();
  });

  it("opens the canonical drawer from a row click and keyboard Enter", async () => {
    await render([buildTask()]);

    const row = container.querySelector<HTMLElement>("[data-task-row]")!;
    await click(row);
    expect(push).toHaveBeenCalledWith(
      "/tasks?view=active&task=task-1",
      { scroll: false },
    );

    push.mockReset();
    await act(async () => {
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(push).toHaveBeenCalledWith(
      "/tasks?view=active&task=task-1",
      { scroll: false },
    );
  });

  it("supports multi-select bulk Complete and Archive", async () => {
    const tasks = [
      buildTask({ id: "task-1" }),
      buildTask({ id: "task-2", title: "Second task" }),
    ];
    const { bulkFieldAction, bulkArchiveAction } = await render(tasks);

    const selectBoxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[aria-label^="Select "]'),
    );
    expect(selectBoxes.length).toBe(2);
    for (const checkbox of selectBoxes) {
      await click(checkbox);
    }

    expect(container.textContent).toContain("2 selected");

    const complete = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Complete",
    );
    await click(complete!);
    expect(bulkFieldAction).toHaveBeenCalledWith(
      expect.objectContaining({
        taskIds: ["task-1", "task-2"],
        field: "status",
        value: "done",
      }),
    );

    // A successful bulk operation clears the explicit selection, so select the
    // two rows again before exercising Archive.
    for (const checkbox of Array.from(
      container.querySelectorAll<HTMLInputElement>('input[aria-label^="Select "]'),
    )) {
      await click(checkbox);
    }
    const archive = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Archive",
    );
    await click(archive!);
    expect(bulkArchiveAction).toHaveBeenCalledWith(
      expect.objectContaining({
        taskIds: ["task-1", "task-2"],
        archived: true,
      }),
    );
  });

  it("shows an inline Restore control in the Archived view", async () => {
    const { unarchiveAction } = await render(
      [buildTask({ id: "task-done", status: "done", archived_at: "2026-05-02" })],
      { view: "archived" },
    );

    const restore = container.querySelector('[data-testid="task-restore-task-done"]');
    expect(restore).not.toBeNull();
    expect(restore?.textContent).toContain("Restore");
    expect(unarchiveAction).toBeTypeOf("function");
    const hidden = container.querySelector(
      'input[name="taskId"][value="task-done"]',
    );
    expect(hidden).not.toBeNull();
  });

  it("keeps arrow-key navigation inside the rendered rows", async () => {
    await render([
      buildTask({ id: "task-1" }),
      buildTask({ id: "task-2", title: "Second task" }),
    ]);

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-task-row]"),
    );
    rows[0].focus();
    await act(async () => {
      rows[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    expect(document.activeElement).toBe(rows[1]);
  });

  it("shows the schedule time block and Google Calendar indicator on scheduled rows without repeating No due date", async () => {
    await render([
      buildTask({
        id: "task-scheduled",
        due_date: null,
        scheduled_start_at: "2026-11-25T17:30:00.000Z",
        scheduled_end_at: "2026-11-25T19:30:00.000Z",
        calendar_sync_enabled: true,
      }),
    ]);

    const scheduleBadge = container.querySelector(
      '[data-testid="task-schedule-task-scheduled"]',
    );
    expect(scheduleBadge).not.toBeNull();
    expect(scheduleBadge?.getAttribute("title")).toBe("Synced to Google Calendar");
    expect(container.textContent).not.toContain("No due date");
  });
});
