// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDisplayTimezone } from "@/lib/presentation-format";

const refresh = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh(), replace: (...args: unknown[]) => replace(...args) }),
}));

import type { TaskRecord } from "@/lib/services/task-service";
import type { UpdateTaskEditorFormState } from "@/app/tasks/actions";
import { normalizeTaskTableColumns } from "@ega/contracts/common/task-list";
import { parseTaskTableColumns } from "@/lib/task-table-columns";

import { ToastProvider } from "@/components/ui/toast-provider";
import { TaskTable, type TaskTableActions } from "./task-table";

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
    board_rank: null,
    archived_at: null,
    archived_by: null,
    projects: { name: "EGA House" },
    goals: { title: "Tighten weekly review" },
    task_reminders: [],
    task_recurrences: [],
    ...overrides,
  };
}

function buildActions(): TaskTableActions {
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
    bulkFieldAction: vi.fn(),
    bulkArchiveAction: vi.fn(),
    undoAction: vi.fn(),
    updateCellAction: vi.fn(async () => ({
      errorMessage: null,
      savedValue: null,
      updatedAt: null,
    })),
  };
}

function tableProps(overrides: Partial<Parameters<typeof TaskTable>[0]> = {}) {
  return {
    tasks: [buildTask()],
    taskTotalDurations: { "task-1": 3661 },
    returnTo: "/tasks?status=todo&layout=kanban",
    columns: normalizeTaskTableColumns(null),
    sortKey: "updated" as const,
    sortDirection: "desc" as const,
    taskUpdateTaskId: null,
    taskUpdateError: null,
    projectOptions: [{ id: "project-1", name: "EGA House" }],
    goalOptions: [
      { id: "goal-1", title: "Tighten weekly review", projectId: "project-1" },
    ],
    actions: buildActions(),
    ...overrides,
  };
}

function renderTable(
  tasks: TaskRecord[] = [buildTask()],
  actions: TaskTableActions = buildActions(),
  props: Partial<Parameters<typeof TaskTable>[0]> = {},
) {
  return act(async () => {
    root.render(
      <ToastProvider>
        <TaskTable {...tableProps({ tasks, actions, ...props })} />
      </ToastProvider>,
    );
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  refresh.mockClear();
  replace.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("TaskTable dense inventory", () => {
  it("renders a real data table with the consolidated inventory columns", async () => {
    await renderTable();

    const table = container.querySelector("table.data-table");
    expect(table).not.toBeNull();

    const headers = Array.from(container.querySelectorAll("thead th")).map(
      (header) => header.textContent?.trim(),
    );
    // The Task header also carries the select-all control.
    expect(headers).toEqual(["Task", "Priority", "Due", "Status", "Actions"]);
  });

  it("applies persisted column widths and a desktop min-width without a percentage track", async () => {
    await renderTable();

    const table = container.querySelector<HTMLTableElement>("table.data-table");
    expect(table?.classList.contains("min-[761px]:w-full")).toBe(true);
    expect(table?.classList.contains("min-[761px]:min-w-[var(--table-min-width)]")).toBe(true);
    expect(table?.style.getPropertyValue("--table-min-width")).toBe("900px");

    const headers = Array.from(container.querySelectorAll<HTMLTableCellElement>("thead th"));
    expect(headers.map((header) => header.style.width)).toEqual([
      "360px",
      "112px",
      "152px",
      "144px",
      "132px",
    ]);
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

    const titleLink = container.querySelector<HTMLAnchorElement>(
      '[data-testid="task-title-open-task-1"]',
    );
    expect(titleLink).not.toBeNull();
    expect(titleLink?.className).toContain("task-row-title-btn");
    expect(titleLink?.getAttribute("title")).toBe(
      "A genuinely long operational task title that would otherwise explode into many wrapped lines and hurt scanability across the 187-task inventory",
    );
    expect(titleLink?.getAttribute("aria-label")).toBe(
      "Open A genuinely long operational task title that would otherwise explode into many wrapped lines and hurt scanability across the 187-task inventory details",
    );
  });

  it("links the title to the URL-addressable drawer and keeps editing on the row actions", async () => {
    const actions = buildActions();
    await renderTable([buildTask()], actions);

    const titleLink = container.querySelector<HTMLAnchorElement>(
      '[data-testid="task-title-open-task-1"]',
    );
    expect(titleLink).not.toBeNull();
    expect(titleLink?.getAttribute("href")).toBe("/tasks?status=todo&layout=kanban&task=task-1");

    // jsdom cannot perform document navigation; cancel the default so the test
    // observes the click handler's effect rather than an unimplemented nav.
    const cancelNavigation = (event: Event) => event.preventDefault();
    titleLink?.addEventListener("click", cancelNavigation);
    await act(async () => {
      titleLink?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    titleLink?.removeEventListener("click", cancelNavigation);

    // A plain link navigation must not open the editor modal.
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(0);
    expect(document.body.querySelector("form form")).toBeNull();
    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });

  it("keeps the ••• trigger opening the shared editor", async () => {
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
    await renderTable(
      [buildTask(), buildTask({ id: "task-2", title: "Second task" })],
      buildActions(),
      {
        returnTo: "/tasks",
        taskUpdateTaskId: "task-2",
        taskUpdateError: "Could not save task",
      },
    );

    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0].getAttribute("aria-label")).toBe(
      "Edit task Second task",
    );
    expect(dialogs[0].textContent).toContain("Could not save task");
  });

  it("restores focus to the row actions trigger when its editor is dismissed", async () => {
    await renderTable();

    const opener = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-more-options-task-1"]',
    );
    await act(async () => {
      opener?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Radix restores focus from onCloseAutoFocus during the dialog unmount,
    // which lands on a later tick than the dismiss itself. Wait for the
    // documented behavior instead of assuming a single act() flush.
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it("flags done rows quiet and offers the direct archive control only for done tasks", async () => {
    const actions = buildActions();
    await renderTable(
      [buildTask({ status: "done", completed_at: "2026-09-24T09:00:00.000Z" })],
      actions,
      { returnTo: "/tasks" },
    );

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

  it("ega-661: due-state labels in the DUE column use the account local date, not the runtime-local date", async () => {
    // Fixed instant 2026-04-20T16:00:00Z: the account day in Asia/Tokyo is
    // 2026-04-21 while the runtime-local day in UTC/America/New_York is 2026-04-20.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T16:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, timeContext: { timezone: "Asia/Tokyo" } }),
      })),
    );
    setDisplayTimezone("Asia/Tokyo");
    try {
      await renderTable([
        buildTask({ id: "account-due-today", due_date: "2026-04-21" }),
        buildTask({ id: "account-overdue", due_date: "2026-04-20" }),
      ]);

      const dueCell = (taskId: string) => {
        const row = container.querySelector(`#task-${taskId}`);
        expect(row).not.toBeNull();
        const cells = row!.querySelectorAll("td");
        return cells[2]?.textContent ?? "";
      };

      expect(dueCell("account-due-today")).toContain("Due today");
      expect(dueCell("account-overdue")).toContain("Overdue");
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      setDisplayTimezone("UTC");
    }
  });
});

describe("TaskTable selection and bulk actions", () => {
  it("scopes selection to the rendered rows and shows the bulk toolbar", async () => {
    await renderTable([
      buildTask({ id: "task-1", title: "First task", task_recurrences: [] }),
      buildTask({ id: "task-2", title: "Second task", task_recurrences: [] }),
    ]);

    const selectFirst = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Select First task"]',
    );
    await act(async () => {
      selectFirst?.click();
    });

    expect(document.body.textContent).toContain("1 selected");
    const row = document.body.querySelector("#task-task-1");
    expect(row?.getAttribute("aria-selected")).toBe("true");

    const clear = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Clear",
    );
    await act(async () => clear?.click());
    expect(document.body.textContent).not.toContain("1 selected");
  });

  it("select-all covers exactly the rendered rows", async () => {
    await renderTable([
      buildTask({ id: "task-1", title: "First task", task_recurrences: [] }),
      buildTask({ id: "task-2", title: "Second task", task_recurrences: [] }),
    ]);

    const selectAll = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Select all tasks in this view"]',
    );
    await act(async () => selectAll?.click());

    expect(document.body.textContent).toContain("2 selected");
    expect(
      document.body.querySelectorAll('input[aria-label^="Select "]:checked').length,
    ).toBe(3);
  });

  it("archives the selected ids through the bulk action and reports the result", async () => {
    const actions = buildActions();
    actions.bulkArchiveAction = vi.fn(async () => ({
      operationId: "op-1",
      field: "archive" as const,
      applied: 1,
      results: [{ taskId: "task-1", outcome: "applied" as const, message: null }],
      undoable: true,
      errorMessage: null,
    }));

    await renderTable([buildTask({ task_recurrences: [] })], actions);

    const checkbox = document.body.querySelector<HTMLInputElement>(
      'input[aria-label^="Select "]',
    );
    await act(async () => checkbox?.click());

    const archive = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Archive",
    );
    await act(async () => archive?.click());
    await act(async () => {});

    expect(actions.bulkArchiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ taskIds: ["task-1"], archived: true }),
    );
    expect(document.body.textContent).toContain("1 task updated");
  });
});

async function pointerClick(element: Element | null | undefined) {
  await act(async () => {
    element?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
  });
}

async function flushCloseFocus() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function headerLabels() {
  return Array.from(container.querySelectorAll("thead th")).map((header) =>
    header.textContent?.trim(),
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("EGA-792 table view behavior", () => {
  it("keeps header sort and the toolbar sort on the same URL contract", async () => {
    await renderTable([buildTask()], buildActions(), {
      sortKey: "updated",
      sortDirection: "desc",
    });

    const priorityLink = container.querySelector<HTMLAnchorElement>(
      '[data-testid="sort-header-priority"]',
    );
    expect(priorityLink).not.toBeNull();
    // The toolbar's default priority direction is ascending.
    expect(priorityLink?.getAttribute("href")).toContain("sort=priority");
    expect(priorityLink?.getAttribute("href")).not.toContain("dir=");
    expect(priorityLink?.getAttribute("aria-label")).toContain("currently not sorted");

    await renderTable([buildTask()], buildActions(), {
      sortKey: "priority",
      sortDirection: "desc",
    });

    const activeHeader = container.querySelector<HTMLTableCellElement>(
      'th[aria-sort="descending"]',
    );
    expect(activeHeader?.textContent).toContain("Priority");
    const toggledLink = container.querySelector<HTMLAnchorElement>(
      '[data-testid="sort-header-priority"]',
    );
    expect(toggledLink?.getAttribute("href")).toContain("sort=priority");
    expect(toggledLink?.getAttribute("href")).toContain("dir=asc");
  });

  it("persists column visibility in the URL and keeps focus on the toggled control", async () => {
    await renderTable();
    expect(headerLabels()).toEqual(["Task", "Priority", "Due", "Status", "Actions"]);

    await pointerClick(container.querySelector('[data-testid="table-columns-trigger"]'));
    const statusToggle = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Show Status column"]',
    );
    expect(statusToggle).not.toBeNull();
    await act(async () => statusToggle?.click());

    expect(headerLabels()).toEqual(["Task", "Priority", "Due", "Actions"]);
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("cols=task%2Cpriority%2Cdue"),
      { scroll: false },
    );
    expect(document.activeElement).toBe(statusToggle);
  });

  it("reorders columns through the settings controls and preserves the URL state", async () => {
    await renderTable();
    await pointerClick(container.querySelector('[data-testid="table-columns-trigger"]'));

    const movePriorityDown = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Move Priority column down"]',
    );
    expect(movePriorityDown?.disabled).toBe(false);
    await act(async () => movePriorityDown?.click());

    expect(headerLabels()).toEqual(["Task", "Due", "Priority", "Status", "Actions"]);
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("cols=task%2Cdue%2Cpriority%2Cstatus"),
      { scroll: false },
    );
    expect(document.activeElement?.getAttribute("data-column-focus")).toBe(
      "down:priority",
    );
  });

  it("resizes a column with the keyboard handle and clamps to the bounds", async () => {
    await renderTable();
    const handle = container.querySelector<HTMLElement>(
      '[data-testid="column-resize-priority"]',
    );
    expect(handle).not.toBeNull();
    handle?.focus();

    await act(async () => {
      handle?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
      handle?.dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }),
      );
    });

    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("widths=priority%3A128"),
      { scroll: false },
    );
    expect(handle?.getAttribute("aria-valuenow")).toBe("128");
  });

  it("saves a status cell through the single-field action and updates optimistically", async () => {
    const actions = buildActions();
    actions.updateCellAction = vi.fn(async () => ({
      errorMessage: null,
      savedValue: "in_progress",
      updatedAt: "2026-04-28T11:00:00.000Z",
    }));

    await renderTable([buildTask()], actions, { returnTo: "/tasks" });
    await pointerClick(
      container.querySelector('[data-testid="task-status-cell-task-1"] button'),
    );
    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      (entry) => entry.textContent?.includes("In progress"),
    );
    await pointerClick(option);
    await act(async () => {});

    expect(actions.updateCellAction).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        field: "status",
        value: "in_progress",
        expectedUpdatedAt: "2026-04-28T10:00:00.000Z",
        returnTo: "/tasks",
      }),
    );
    expect(refresh).toHaveBeenCalled();
    expect(container.querySelector("#task-task-1")?.textContent).toContain("In progress");
  });

  it("shows a stale-write error inline and never claims a refresh", async () => {
    const actions = buildActions();
    actions.updateCellAction = vi.fn(async () => ({
      errorMessage: "This task changed since you opened it. Reload and try again.",
      savedValue: null,
      updatedAt: null,
    }));

    await renderTable([buildTask()], actions, { returnTo: "/tasks" });
    await pointerClick(
      container.querySelector('[data-testid="task-status-cell-task-1"] button'),
    );
    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      (entry) => entry.textContent?.includes("Done"),
    );
    await pointerClick(option);
    await act(async () => {});

    expect(
      container.querySelector('[data-testid="task-status-cell-task-1-error"]')?.textContent,
    ).toContain("changed since you opened it");
    expect(refresh).not.toHaveBeenCalled();
    expect(container.querySelector("#task-task-1")?.textContent).toContain("To do");
  });

  it("retains a failed due-date draft and exposes the field error", async () => {
    const actions = buildActions();
    actions.updateCellAction = vi.fn(async () => ({
      errorMessage: "This task changed since you opened it. Reload and try again.",
      savedValue: null,
      updatedAt: null,
    }));

    await renderTable([buildTask()], actions, { returnTo: "/tasks" });
    await pointerClick(
      container.querySelector('[data-testid="task-due-cell-task-1-trigger"]'),
    );
    const input = document.body.querySelector<HTMLInputElement>(
      '[role="dialog"] input[type="date"]',
    );
    expect(input?.value).toBe("2026-05-01");
    await act(async () => setInputValue(input!, "2026-05-10"));

    const form = input?.closest("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {});

    expect(actions.updateCellAction).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "dueDate",
        value: "2026-05-10",
        expectedUpdatedAt: "2026-04-28T10:00:00.000Z",
      }),
    );
    expect(input?.value).toBe("2026-05-10");
    expect(document.body.textContent).toContain("changed since you opened it");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("edits a project only when the project column is shown", async () => {
    const actions = buildActions();
    actions.updateCellAction = vi.fn(async () => ({
      errorMessage: null,
      savedValue: "project-2",
      updatedAt: "2026-04-28T11:00:00.000Z",
    }));

    await renderTable([buildTask()], actions, {
      returnTo: "/tasks",
      columns: parseTaskTableColumns({ cols: "task,project,priority,due,status" }),
      projectOptions: [
        { id: "project-1", name: "EGA House" },
        { id: "project-2", name: "Second project" },
      ],
    });

    expect(container.querySelector('[data-testid="task-project-cell-task-1"]')).not.toBeNull();
    await pointerClick(
      container.querySelector('[data-testid="task-project-cell-task-1"] button'),
    );
    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      (entry) => entry.textContent?.includes("Second project"),
    );
    await pointerClick(option);
    await act(async () => {});

    expect(actions.updateCellAction).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        field: "project",
        value: "project-2",
      }),
    );
    expect(container.querySelector("#task-task-1")?.textContent).toContain("Second project");
  });

  it("returns focus to the cell trigger after Escape", async () => {
    await renderTable([buildTask()], buildActions(), { returnTo: "/tasks" });
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-due-cell-task-1-trigger"]',
    );
    trigger?.focus();
    await pointerClick(trigger);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flushCloseFocus();
    expect(document.activeElement).toBe(trigger);
  });
});
