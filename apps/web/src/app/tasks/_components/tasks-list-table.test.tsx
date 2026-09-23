import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskRecord } from "@/lib/services/task-service";

import { TasksListTable, type TaskListActions } from "./tasks-list-table";

let container: HTMLDivElement;
let root: Root;

function buildTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    title: "Draft weekly execution review",
    description: "Summarize the week and pick the next lever.",
    blocked_reason: null,
    status: "todo",
    priority: "high",
    due_date: "2026-05-01",
    planned_for_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    estimate_minutes: 75,
    updated_at: "2026-04-28T10:00:00.000Z",
    completed_at: null,
    project_id: "project-1",
    goal_id: "goal-1",
    focus_rank: null,
    archived_at: null,
    archived_by: null,
    projects: { name: "EGA House" },
    goals: { title: "Tighten weekly review" },
    task_reminders: [],
    task_recurrences: [],
    ...overrides,
  };
}

function buildActions(): TaskListActions {
  return {
    updateAction: vi.fn(),
    deleteAction: vi.fn(),
    archiveAction: vi.fn(),
    unarchiveAction: vi.fn(),
    startTimerAction: vi.fn(),
    pinAction: vi.fn(),
    unpinAction: vi.fn(),
    createReminderAction: vi.fn(),
    cancelReminderAction: vi.fn(),
  };
}

function renderTable(
  tasks: TaskRecord[] = [buildTask()],
  actions: TaskListActions = buildActions(),
) {
  return act(async () => {
    root.render(
      <TasksListTable
        tasks={tasks}
        taskTotalDurations={{ "task-1": 3661 }}
        returnTo="/tasks?status=todo&layout=kanban"
        taskUpdateTaskId={null}
        taskUpdateError={null}
        actions={actions}
      />,
    );
  });
}

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

describe("TasksListTable dense inventory", () => {
  it("renders a real data table with the inventory columns", async () => {
    await renderTable();

    const table = container.querySelector("table.data-table");
    expect(table).not.toBeNull();

    const headers = Array.from(container.querySelectorAll("thead th")).map(
      (header) => header.textContent?.trim(),
    );
    expect(headers).toEqual([
      "Task",
      "Project",
      "Goal",
      "Priority",
      "Due",
      "Status",
      "Actions",
    ]);
  });

  it("lets the table fill its column with content-responsive tracks", async () => {
    await renderTable();

    const table = container.querySelector("table.data-table");
    expect(table?.classList.contains("min-[761px]:w-full")).toBe(true);
    // The old 51rem floor forced an inner scroll on a 1280 desktop; the new
    // floor only engages below tablet width, where the wrapper scrolls.
    expect(table?.classList.contains("min-[761px]:min-w-[44rem]")).toBe(true);
    expect(table?.className).not.toContain("min-w-[51rem]");

    const headerWidths = Array.from(container.querySelectorAll("thead th")).map(
      (header) => header.getAttribute("class") ?? "",
    );
    // Secondary columns are percentage tracks; only the Task column is auto.
    expect(headerWidths[1]).toContain("w-[12.5%]");
    expect(headerWidths[2]).toContain("w-[12%]");
    expect(headerWidths[3]).toContain("w-[11%]");
    expect(headerWidths[6]).toContain("w-[11%]");
  });

  it("keeps a title tooltip on project and goal values and shows the estimate in the task cell", async () => {
    await renderTable();

    const projectSpan = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "EGA House",
    );
    expect(projectSpan?.getAttribute("title")).toBe("EGA House");
    expect(projectSpan?.classList.contains("truncate")).toBe(true);

    const goalSpan = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "Tighten weekly review",
    );
    expect(goalSpan?.getAttribute("title")).toBe("Tighten weekly review");

    // The estimate column was folded into the Task cell (hidden on phones,
    // where the phone meta badge carries it instead).
    const estimateBadge = Array.from(container.querySelectorAll("span")).find(
      (span) =>
        span.textContent === "Est. 1h 15m" && span.classList.contains("max-[761px]:hidden"),
    );
    expect(estimateBadge).not.toBeUndefined();

    // Desktop due cell is compact; the phone label keeps the full date.
    const dueCell = Array.from(container.querySelectorAll("span")).find((span) =>
      span.getAttribute("title") === "May 1, 2026",
    );
    expect(dueCell?.textContent).toContain("May 1");
    expect(dueCell?.textContent).not.toContain("2026");
  });

  it("keeps the #task-<id> anchor and one progressive-disclosure editor per row", async () => {
    await renderTable();

    const row = container.querySelector<HTMLTableRowElement>("#task-task-1");
    expect(row).not.toBeNull();
    expect(row?.tagName).toBe("TR");
    expect(container.querySelectorAll('[data-testid="task-more-options-task-1"]').length).toBe(1);
  });

  it("stacks the same row as a task-row item at phone widths", async () => {
    await renderTable();

    const table = container.querySelector("table.data-table");
    expect(table?.classList.contains("max-[761px]:block")).toBe(true);

    const head = container.querySelector("thead");
    expect(head?.classList.contains("max-[761px]:hidden")).toBe(true);

    // The row reproduces the shared .task-row grammar only below 761px, so the
    // desktop table row keeps native padding/borders.
    const row = container.querySelector("#task-task-1");
    for (const utility of [
      "max-[761px]:flex",
      "max-[761px]:flex-col",
      "max-[761px]:gap-2.5",
      "max-[761px]:border-b",
      "max-[761px]:px-3.5",
      "max-[761px]:py-3",
    ]) {
      expect(row?.classList.contains(utility)).toBe(true);
    }
    expect(row?.classList.contains("task-row")).toBe(false);

    // The Task cell collapses to contents so its children stack in the row;
    // the phone-only metadata block is hidden again above 760px.
    const taskCell = row?.querySelector("td");
    expect(taskCell?.classList.contains("max-[761px]:contents")).toBe(true);

    const phoneMeta = row?.querySelector('[data-testid="task-phone-meta-task-1"]');
    expect(phoneMeta).not.toBeNull();
    expect(phoneMeta?.classList.contains("min-[761px]:hidden")).toBe(true);
    expect(phoneMeta?.textContent).toContain("To do");
    expect(phoneMeta?.textContent).toContain("High");
    expect(phoneMeta?.textContent).toContain("Due May 1, 2026");
    expect(phoneMeta?.textContent).toContain("Tracked 1h 1m 1s");
    expect(row?.textContent).toContain("Summarize the week and pick the next lever.");
  });

  it("renders row data from the model and omits missing optional values", async () => {
    await renderTable([
      buildTask(),
      buildTask({
        id: "task-2",
        title: "Minimal task",
        description: null,
        priority: "medium",
        due_date: null,
        estimate_minutes: null,
        projects: null,
        goals: null,
        task_recurrences: [],
      }),
    ]);

    expect(container.textContent).toContain("EGA House");
    expect(container.textContent).toContain("Tighten weekly review");
    expect(container.textContent).toContain("Due May 1, 2026");
    expect(container.textContent).toContain("1h 15m");

    const minimalRow = container.querySelector("#task-task-2");
    expect(minimalRow).not.toBeNull();
    expect(minimalRow?.textContent).toContain("Minimal task");
    expect(minimalRow?.textContent).toContain("Medium");
    expect(minimalRow?.textContent).not.toContain("No project");
  });

  it("exposes the primary action and compact progressive disclosure with the same wiring", async () => {
    const actions = buildActions();
    await renderTable([buildTask()], actions);

    const startTimer = container.querySelector('[data-testid="task-start-timer-task-1"]');
    expect(startTimer).not.toBeNull();
    expect(startTimer?.getAttribute("aria-label")).toBe("Start timer for Draft weekly execution review");
    expect(startTimer?.textContent).toBe("");

    const moreOptions = container.querySelector('[data-testid="task-more-options-task-1"]');
    expect(moreOptions?.getAttribute("aria-label")).toBe(
      "More options for Draft weekly execution review",
    );
    expect(moreOptions?.textContent).toBe("");

    const markDone = container.querySelector('button[aria-label="Mark Draft weekly execution review done"]');
    expect(markDone).not.toBeNull();

    // Canonical hidden fields survive in both the timer and completion forms.
    const hiddenTaskIds = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[name="taskId"][value="task-1"]'),
    );
    expect(hiddenTaskIds.length).toBeGreaterThanOrEqual(2);
    const returnToValues = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[name="returnTo"]'),
    ).map((input) => input.value);
    expect(returnToValues).toContain("/tasks?status=todo&layout=kanban");
    expect(container.querySelector('input[name="status"][value="done"]')).not.toBeNull();

    // Opening the editor mutates nothing.
    await act(async () => {
      moreOptions?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });

  it("auto-opens the editor for the row that carries the save error", async () => {
    await act(async () => {
      root.render(
        <TasksListTable
          tasks={[buildTask(), buildTask({ id: "task-2", title: "Second task" })]}
          taskTotalDurations={{}}
          returnTo="/tasks"
          taskUpdateTaskId="task-2"
          taskUpdateError="Could not save task"
          actions={buildActions()}
        />,
      );
    });

    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0].getAttribute("aria-label")).toBe(
      "Advanced task settings for Second task",
    );
    expect(dialogs[0].textContent).toContain("Could not save task");
  });
});
