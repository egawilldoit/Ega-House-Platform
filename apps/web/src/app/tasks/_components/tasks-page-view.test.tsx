// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/app/tasks/actions", () => ({
  archiveManyCompletedTasksAction: vi.fn(),
  archiveTaskAction: vi.fn(),
  cancelTaskReminderAction: vi.fn(),
  addSubtaskAction: vi.fn(),
  toggleSubtaskAction: vi.fn(),
  renameSubtaskAction: vi.fn(),
  deleteSubtaskAction: vi.fn(),
  moveSubtaskAction: vi.fn(),
  promoteSubtaskAction: vi.fn(),
  moveTaskOnBoardAction: vi.fn(),
  bulkTaskFieldAction: vi.fn(),
  bulkTaskArchiveAction: vi.fn(),
  undoTaskOperationAction: vi.fn(),
  createTaskReminderAction: vi.fn(),
  deleteTaskAction: vi.fn(),
  addTaskDependencyAction: vi.fn(),
  removeTaskDependencyAction: vi.fn(),
  updateTaskFieldAction: vi.fn(),
  updateTaskFieldDraftAction: vi.fn(),
  updateTaskTimelineScheduleAction: vi.fn(),
  pinTaskAction: vi.fn(),
  unarchiveTaskAction: vi.fn(),
  unpinTaskAction: vi.fn(),
  updateTaskEditorAction: vi.fn(),
  updateTaskReminderAction: vi.fn(),
  updateTaskInlineAction: vi.fn(),
  updateTaskTableCellAction: vi.fn(),
}));

vi.mock("@/app/timer/actions", () => ({
  startTimerAction: vi.fn(),
}));

vi.mock("@/app/tasks/saved-views-actions", () => ({
  createTaskSavedViewAction: vi.fn(),
  deleteTaskSavedViewAction: vi.fn(),
  updateTaskSavedViewAction: vi.fn(),
}));

vi.mock("@/app/tasks/create-task-form", () => ({
  CreateTaskForm: () => <form data-testid="mock-create-task-form" />,
}));

import { buildTaskKanbanBoard, buildTaskListUrl } from "@/lib/task-list";
import { resolveTimelineRange } from "@/lib/task-timeline";
import { QUICK_TASK_EVENT } from "@/lib/workspace-events";
import type { TaskRecord } from "@/lib/services/task-service";
// Imports the mocked factory above, so assertions observe what the server
// component actually submits.
import { archiveManyCompletedTasksAction } from "@/app/tasks/actions";

import { ToastProvider } from "@/components/ui/toast-provider";
import { TasksPageView } from "./TasksPageView";

type TasksPageViewModel = Parameters<typeof TasksPageView>[0]["model"];

function buildTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    title: "Draft weekly execution review",
    description: "Summarize the week.",
    blocked_reason: null,
    status: "in_progress",
    priority: "high",
    due_date: "2026-05-01",
    planned_for_date: null,
    start_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    estimate_minutes: 75,
    updated_at: "2026-04-28T10:00:00.000Z",
    completed_at: null,
    project_id: "project-1",
    goal_id: "goal-1",
    focus_rank: 1,
    board_rank: "A",
    archived_at: null,
    archived_by: null,
    projects: { name: "EGA House" },
    goals: { title: "Tighten weekly review" },
    task_reminders: [],
    task_recurrences: [],
    ...overrides,
  };
}

function buildModel(overrides: Partial<TasksPageViewModel> = {}): TasksPageViewModel {
  const tasks = overrides.tasks ?? [buildTask()];

  return {
    parsed: {
      activeStatus: "in_progress",
      activeDueFilter: "overdue",
      activeSort: "due_date_asc",
      activeLayout: "list",
      activeDensity: "comfortable",
      activeView: "active",
      activeBoardOrder: null,
      projectParam: "project-1",
      goalParam: "goal-1",
      savedViewDefinitionFilters: {
        status: "in_progress",
        projectId: "project-1",
        goalId: "goal-1",
        dueFilter: "overdue",
        sortValue: "due_date_asc",
        activeTasks: false,
        priorityValues: [],
        estimateMinMinutes: null,
        estimateMaxMinutes: null,
        dueWithinDays: null,
      },
      view: {
        version: 2,
        filters: [
          { field: "status", operator: "is", values: ["in_progress"] },
          { field: "project", operator: "is", values: ["project-1"] },
          { field: "goal", operator: "is", values: ["goal-1"] },
          { field: "due_bucket", operator: "is", values: ["overdue"] },
        ],
        groupBy: "none",
        sort: { key: "due", direction: "asc" },
        search: "",
        activeOnly: false,
      },
      taskUpdateError: null,
      taskUpdateSuccess: null,
      taskUpdateTaskId: null,
      savedViewFeedback: { error: null, success: null },
    },
    selectedTaskId: null,
    selectedTaskMode: "panel",
    selectedTask: null,
    selectedTaskError: false,
    selectedTaskSubtasks: [],
    selectedTaskActivity: [],
    selectedTaskActivityHasMore: false,
    selectedTaskComments: {
      comments: [],
      mentionCandidates: [],
      errorMessage: null,
    },
    selectedTaskCommentMentions: [],
    selectedTaskCommentError: null,
    selectedTaskIsFavourite: false,
    subtaskCounts: {},
    projects: [{ id: "project-1", name: "EGA House" }],
    goals: [{ id: "goal-1", title: "Tighten weekly review", project_id: "project-1" }],
    tasks,
    taskTotalDurations: Object.fromEntries(tasks.map((task) => [task.id, 60])),
    summary: { total: 3, active: 2, archived: 1 },
    savedViews: [],
    activeProjectId: "project-1",
    activeGoalId: "goal-1",
    returnPath: buildTaskListUrl("/tasks", {
      filters: [
        { field: "status", operator: "is", values: ["in_progress"] },
        { field: "project", operator: "is", values: ["project-1"] },
        { field: "goal", operator: "is", values: ["goal-1"] },
        { field: "due_bucket", operator: "is", values: ["overdue"] },
      ],
      sortKey: "due",
      sortDirection: "asc",
    }),
    taskUrlFilters: {
      filters: [
        { field: "status", operator: "is", values: ["in_progress"] },
        { field: "project", operator: "is", values: ["project-1"] },
        { field: "goal", operator: "is", values: ["goal-1"] },
        { field: "due_bucket", operator: "is", values: ["overdue"] },
      ],
      group: "none",
      q: "",
      sortKey: "due",
      sortDirection: "asc",
      activeTasks: false,
      density: null,
      boardOrder: null,
      columns: undefined,
    },
    groups: [{ key: "all", label: "All tasks", count: tasks.length, tasks }],
    filteredTotal: tasks.length,
    loadedCount: tasks.length,
    truncated: false,
    kanbanBoard: buildTaskKanbanBoard(tasks, "in_progress"),
    inProgressCount: 1,
    blockedCount: 1,
    overdueCount: 1,
    dueSoonCount: 0,
    timeline: null,
    timelineRange: resolveTimelineRange("2026-05-01"),
    timelineZoom: "week",
    ownerToday: "2026-05-01",
    ...overrides,
  };
}

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

async function render(model: TasksPageViewModel = buildModel()) {
  await act(async () => {
    root.render(
      <ToastProvider>
        <TasksPageView model={model} />
      </ToastProvider>,
    );
  });
}

function findLink(label: string) {
  return Array.from(container.querySelectorAll("a")).find(
    (anchor) => anchor.textContent?.trim() === label,
  );
}

describe("TasksPageView workspace composition", () => {
  it("keeps view and layout switches URL-authoritative and filter-preserving", async () => {
    await render();

    // The display label is "Current"; the query value stays the not-archived
    // scope (no `archive` param), exactly as before.
    expect(findLink("Current")?.getAttribute("href")).toBe(
      "/tasks?status=in_progress&project=project-1&goal=goal-1&due=overdue&sort=due",
    );
    expect(findLink("Archived")?.getAttribute("href")).toBe(
      "/tasks?status=in_progress&project=project-1&goal=goal-1&due=overdue&sort=due&archive=archived",
    );
    expect(findLink("All")?.getAttribute("href")).toBe(
      "/tasks?status=in_progress&project=project-1&goal=goal-1&due=overdue&sort=due&archive=all",
    );
    expect(findLink("List")?.getAttribute("href")).toBe(
      "/tasks?status=in_progress&project=project-1&goal=goal-1&due=overdue&sort=due",
    );
    expect(findLink("Board")?.getAttribute("href")).toBe(
      "/tasks?status=in_progress&project=project-1&goal=goal-1&due=overdue&sort=due&layout=kanban",
    );

    expect(findLink("Current")?.getAttribute("aria-current")).toBe("page");
    expect(findLink("List")?.getAttribute("aria-current")).toBe("page");
    expect(findLink("Active")).toBeUndefined();
  });

  it("defaults to the dense table and switches to the kanban board", async () => {
    await render();
    expect(container.querySelector("table.data-table")).not.toBeNull();
    expect(container.querySelector(".tasks-kanban-board")).toBeNull();

    await render(
      buildModel({
        parsed: { ...buildModel().parsed, activeLayout: "kanban", activeStatus: null },
        kanbanBoard: buildTaskKanbanBoard([buildTask()], null),
      }),
    );
    expect(container.querySelector("table.data-table")).toBeNull();
    const board = container.querySelector(".tasks-kanban-board");
    expect(board).not.toBeNull();
    expect(board?.querySelectorAll(".tasks-kanban-column").length).toBe(5);
  });

  it("renders one quiet summary line and exactly one page-level new-task CTA", async () => {
    const quickTask = vi.fn();
    window.addEventListener(QUICK_TASK_EVENT, quickTask);

    await render();

    const summary = container.querySelector('[data-testid="tasks-summary"]');
    expect(summary?.textContent).toBe("1 shown · 1 matching · 3 total · 1 overdue · 1 in progress · 1 blocked");

    // The rail no longer duplicates the primary CTA; the toolbar owns it.
    expect(container.querySelectorAll('[data-testid="tasks-new-task"]').length).toBe(1);
    expect(container.querySelector('[data-testid="tasks-rail-new-task"]')).toBeNull();

    await act(async () => {
      container
        .querySelector('[data-testid="tasks-new-task"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(quickTask).toHaveBeenCalledTimes(1);
    // The surface reuses the shell's single QuickTaskSheet.
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    window.removeEventListener(QUICK_TASK_EVENT, quickTask);
  });

  it("no longer renders a secondary rail: no Focus, Pinned tasks or Saved views", async () => {
    await render();

    // The product decision is to remove these surfaces from /tasks entirely, not
    // to hide them: nothing may render and no empty column may remain.
    expect(container.querySelector(".workspace-secondary-rail")).toBeNull();
    expect(container.querySelector("aside")).toBeNull();
    expect(container.textContent).not.toContain("Pinned tasks");
    expect(container.textContent).not.toContain("Saved views");
    expect(container.textContent).not.toContain("Quick add task");
    expect(container.textContent).not.toContain("No pinned tasks.");
  });

  it("gives the inventory the reclaimed width instead of leaving a rail column", async () => {
    await render();

    const root = container.firstElementChild;
    // The inventory wrapper must not reserve a second grid track for a rail.
    expect(root?.className).not.toContain("workspace-main-rail-grid");
    expect(container.querySelectorAll("table.data-table").length).toBe(1);
  });

  it("renders filter-aware and truly-empty list states", async () => {
    await render(
      buildModel({
        tasks: [],
        kanbanBoard: buildTaskKanbanBoard([], "in_progress"),
      }),
    );
    expect(container.textContent).toContain("No tasks match current filters");
    expect(findLink("Reset filters")?.getAttribute("href")).toBe("/tasks");

    await render(
      buildModel({
        tasks: [],
        summary: { total: 0, active: 0, archived: 0 },
        kanbanBoard: buildTaskKanbanBoard([], "in_progress"),
      }),
    );
    expect(container.textContent).toContain("No tasks yet");
    expect(container.querySelector('[data-testid="tasks-new-task"]')).not.toBeNull();
  });

  it("renders the board empty state instead of four empty columns", async () => {
    await render(
      buildModel({
        tasks: [],
        kanbanBoard: buildTaskKanbanBoard([], null),
        parsed: { ...buildModel().parsed, activeLayout: "kanban", activeStatus: null },
      }),
    );
    expect(container.textContent).toContain("No tasks match current filters");
    expect(container.querySelector(".tasks-kanban-board")).toBeNull();
  });
});

describe("TasksPageView completed-task cleanup", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => false);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it("offers a single bulk archive action counting only completed non-archived tasks in scope", async () => {
    await render(
      buildModel({
        tasks: [
          buildTask({ id: "task-done-1", status: "done", focus_rank: null, archived_at: null }),
          buildTask({ id: "task-done-2", status: "done", focus_rank: null, archived_at: null }),
          buildTask({ id: "task-active", status: "in_progress", focus_rank: null, archived_at: null }),
        ],
        summary: { total: 3, active: 3, archived: 0 },
      }),
    );

    const bulk = container.querySelector<HTMLButtonElement>('[data-testid="tasks-archive-completed"]');
    expect(bulk).not.toBeNull();
    expect(bulk?.textContent).toContain("Archive completed (2)");

    await act(async () => {
      bulk!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The confirmation follow the existing window.confirm convention and never
    // implies deletion.
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain(
      "Archive 2 completed tasks? These tasks will move to Archived and can be restored later.",
    );
    expect(confirmSpy.mock.calls[0][0].toLowerCase()).not.toContain("delet");
    expect(archiveManyCompletedTasksAction).not.toHaveBeenCalled();
  });

  it("confirms and submits only the eligible completed task ids", async () => {
    confirmSpy.mockImplementation(() => true);

    await render(
      buildModel({
        tasks: [
          buildTask({ id: "task-done-1", status: "done", focus_rank: null, archived_at: null }),
          buildTask({ id: "task-done-2", status: "done", focus_rank: null, archived_at: null }),
        ],
        summary: { total: 2, active: 2, archived: 0 },
      }),
    );

    const bulk = container.querySelector<HTMLButtonElement>('[data-testid="tasks-archive-completed"]');
    expect(bulk).not.toBeNull();

    // jsdom does not auto-submit React forms from synthetic clicks; dispatch a
    // bubbling click on the submit button the way a real user activation does.
    await act(async () => {
      bulk!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(archiveManyCompletedTasksAction).toHaveBeenCalledTimes(1);
    const formData = (archiveManyCompletedTasksAction as ReturnType<typeof vi.fn>).mock.calls[0][0] as FormData;
    const ids = formData.getAll("taskIds").map(String).sort();
    expect(ids).toEqual(["task-done-1", "task-done-2"]);
    expect(formData.get("returnTo")).toBe(buildModel().returnPath);
    expect(formData.get("confirmArchiveCompleted")).toBe("true");
  });

  it("does not submit the bulk action when the confirmation is dismissed", async () => {
    await render(
      buildModel({
        tasks: [buildTask({ id: "task-done-1", status: "done", focus_rank: null, archived_at: null })],
        summary: { total: 1, active: 1, archived: 0 },
      }),
    );

    const bulk = container.querySelector<HTMLButtonElement>('[data-testid="tasks-archive-completed"]');
    await act(async () => {
      bulk!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(archiveManyCompletedTasksAction).not.toHaveBeenCalled();
  });

  it("hides the bulk action with no completed tasks to clean up", async () => {
    await render(
      buildModel({
        tasks: [buildTask({ id: "task-active", status: "in_progress", focus_rank: null })],
        summary: { total: 1, active: 1, archived: 0 },
      }),
    );

    expect(container.querySelector('[data-testid="tasks-archive-completed"]')).toBeNull();
  });

  it("keeps the bulk action scoped out of Archived and All views", async () => {
    for (const view of ["archived", "all"] as const) {
      container.remove();
      await render(
        buildModel({
          parsed: { ...buildModel().parsed, activeView: view },
          tasks: [buildTask({ id: "task-done-1", status: "done", focus_rank: null, archived_at: null })],
          summary: { total: 1, active: 1, archived: 0 },
        }),
      );
      expect(container.querySelector('[data-testid="tasks-archive-completed"]')).toBeNull();
    }
  });
});
