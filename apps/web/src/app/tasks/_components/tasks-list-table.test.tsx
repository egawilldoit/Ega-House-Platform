import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

import type { TaskRecord } from "@/lib/services/task-service";
import type { UpdateTaskEditorFormState } from "@/app/tasks/actions";

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
    updateEditorAction: vi.fn(
      async (
        _previous: UpdateTaskEditorFormState,
        _formData: FormData,
      ): Promise<UpdateTaskEditorFormState> => ({
        errorMessage: null,
        successMessage: null,
        taskId: null,
      }),
    ),
    deleteAction: vi.fn(),
    archiveAction: vi.fn(),
    unarchiveAction: vi.fn(),
    startTimerAction: vi.fn(),
    pinAction: vi.fn(),
    unpinAction: vi.fn(),
    createReminderAction: vi.fn(),
    updateReminderAction: vi.fn(),
    cancelReminderAction: vi.fn(),
  };
}

function renderTable(
  tasks: TaskRecord[] = [buildTask()],
  actions: TaskListActions = buildActions(),
  props: Partial<Parameters<typeof TasksListTable>[0]> = {},
) {
  return act(async () => {
    root.render(
      <TasksListTable
        tasks={tasks}
        taskTotalDurations={{ "task-1": 3661 }}
        returnTo="/tasks?status=todo&layout=kanban"
        taskUpdateTaskId={null}
        taskUpdateError={null}
        projectOptions={[{ id: "project-1", name: "EGA House" }]}
        goalOptions={[{ id: "goal-1", title: "Tighten weekly review", projectId: "project-1" }]}
        actions={actions}
        {...props}
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
  it("renders a real data table with the consolidated inventory columns", async () => {
    await renderTable();

    const table = container.querySelector("table.data-table");
    expect(table).not.toBeNull();

    const headers = Array.from(container.querySelectorAll("thead th")).map(
      (header) => header.textContent?.trim(),
    );
    expect(headers).toEqual(["Task", "Priority", "Due", "Status", "Actions"]);
  });

  it("lets the table fill its column without the removed Project/Goal tracks", async () => {
    await renderTable();

    const table = container.querySelector("table.data-table");
    expect(table?.classList.contains("min-[761px]:w-full")).toBe(true);

    const headerWidths = Array.from(container.querySelectorAll("thead th")).map(
      (header) => header.getAttribute("class") ?? "",
    );
    const trackOf = (index: number) => {
      const match = headerWidths[index]?.match(/w-\[(\d+(?:\.\d+)?)%\]/);
      return match ? Number(match[1]) : null;
    };

    // The Task column stays auto so it takes every leftover pixel and acts as
    // the remaining space owner.
    expect(headerWidths[0]).not.toMatch(/w-\[/);
    // The compact state columns are percentage tracks.
    for (const index of [1, 2, 3, 4]) {
      expect(trackOf(index)).not.toBeNull();
    }
  });

  it("carries project and goal as a muted context line under the title", async () => {
    await renderTable();

    const rows = container.querySelectorAll("#task-task-1");
    expect(rows.length).toBe(1);
    const contextLine = container.querySelector('[data-testid="task-context-line"]');
    expect(contextLine).not.toBeNull();
    expect(contextLine?.textContent).toContain("EGA House");
    expect(contextLine?.textContent).toContain("·");
    expect(contextLine?.textContent).toContain("Tighten weekly review");
  });

  it("keeps project alone when no goal and never renders a dangling separator", async () => {
    await renderTable([
      buildTask({
        id: "task-2",
        title: "Project-only task",
        goals: null,
        description: null,
        task_recurrences: [],
      }),
      buildTask({
        id: "task-3",
        title: "Unassigned task",
        projects: null,
        goals: null,
        description: null,
        task_recurrences: [],
      }),
    ]);

    const projectOnlyContext = container
      .querySelector("#task-task-2 [data-testid='task-context-line']")
      ?.textContent;
    expect(projectOnlyContext).toContain("EGA House");
    expect(projectOnlyContext).not.toContain("·");

    const unassignedRow = container.querySelector("#task-task-3");
    expect(unassignedRow?.querySelector("[data-testid='task-context-line']")).toBeNull();
    expect(unassignedRow?.textContent).toContain("Unassigned task");
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

  it("truncates long titles to a single line while keeping the full text discoverable", async () => {
    await renderTable([
      buildTask({
        title: "A genuinely long operational task title that would otherwise explode into many wrapped lines and hurt scanability across the 187-task inventory",
      }),
    ]);

    const titleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-title-edit-task-1"]',
    );
    expect(titleButton).not.toBeNull();
    expect(titleButton?.className).toContain("task-row-title-btn");
    expect(titleButton?.getAttribute("title")).toBe(
      "A genuinely long operational task title that would otherwise explode into many wrapped lines and hurt scanability across the 187-task inventory",
    );
    expect(titleButton?.getAttribute("aria-label")).toBe(
      "Edit A genuinely long operational task title that would otherwise explode into many wrapped lines and hurt scanability across the 187-task inventory",
    );
  });

  it("opens the shared EditTaskModal from the title and never submits anything", async () => {
    const actions = buildActions();
    await renderTable([buildTask()], actions);

    const titleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-title-edit-task-1"]',
    );
    expect(titleButton).not.toBeNull();

    await act(async () => {
      titleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0].getAttribute("aria-label")).toBe("Edit task Draft weekly execution review");
    expect(document.body.querySelector("form form")).toBeNull();
    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });

  it("keeps the ••• trigger and the title wired to one editor per row", async () => {
    await renderTable();

    const moreOptions = container.querySelector('[data-testid="task-more-options-task-1"]');
    await act(async () => {
      moreOptions?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
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
      "Edit task Second task",
    );
    expect(dialogs[0].textContent).toContain("Could not save task");
  });

  it("restores focus to the title when a title-opened editor is dismissed", async () => {
    await renderTable();

    const titleButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-title-edit-task-1"]',
    );
    await act(async () => {
      titleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {});
    expect(document.activeElement).toBe(titleButton);
  });

  it("flags done rows quiet and offers the direct archive control only for done tasks", async () => {
    const actions = buildActions();
    await act(async () => {
      root.render(
        <TasksListTable
          tasks={[buildTask({ status: "done", completed_at: "2026-09-24T09:00:00.000Z" })]}
          taskTotalDurations={{}}
          returnTo="/tasks"
          taskUpdateTaskId={null}
          taskUpdateError={null}
          actions={actions}
        />,
      );
    });

    const row = container.querySelector("#task-task-1");
    expect(row?.getAttribute("data-row-done")).toBe("true");

    const archiveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-archive-task-1"]',
    );
    expect(archiveButton).not.toBeNull();
    expect(archiveButton?.getAttribute("aria-label")).toBe("Archive Draft weekly execution review");
    expect(container.querySelector('button[aria-label="Mark Draft weekly execution review done"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Start timer for Draft weekly execution review"]')).toBeNull();

    await act(async () => {
      archiveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Submitting archive must invoke only the archive action — it never falls
    // through to the row editor or delete path.
    expect(actions.archiveAction).toHaveBeenCalledTimes(1);
    expect(actions.updateAction).not.toHaveBeenCalled();
    expect(actions.deleteAction).not.toHaveBeenCalled();
  });

  it("does not expose the direct archive shortcut for incomplete tasks in Current", async () => {
    await renderTable([buildTask({ status: "in_progress" })]);

    expect(
      container.querySelector('[data-testid="task-archive-task-1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="task-restore-task-1"]'),
    ).toBeNull();
  });

  it("keeps Done state visible for an archived row and offers Restore", async () => {
    await renderTable([
      buildTask({
        status: "done",
        completed_at: "2026-09-24T09:00:00.000Z",
        archived_at: "2026-09-25T08:00:00.000Z",
      }),
    ]);

    const row = container.querySelector("#task-task-1");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-row-archived")).toBe("true");
    expect(row?.textContent).toContain("Done");
    expect(row?.textContent).toContain("Archived");

    const restoreButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-restore-task-1"]',
    );
    expect(restoreButton).not.toBeNull();
    expect(restoreButton?.getAttribute("aria-label")).toBe("Restore Draft weekly execution review");
    expect(
      container.querySelector('[data-testid="task-archive-task-1"]'),
    ).toBeNull();

    await act(async () => {
      restoreButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      (container.querySelector('[data-testid="task-restore-task-1"]') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("renders the compact density with the trim marker", async () => {
    await renderTable([buildTask()], buildActions(), { density: "compact" });

    expect(container.querySelector(".data-table--density-compact")).not.toBeNull();
  });
});
