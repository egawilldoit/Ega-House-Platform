// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
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

vi.mock("@/app/(workspace)/tasks/actions", () => ({
  cancelTaskReminderAction: vi.fn(),
  createTaskReminderAction: vi.fn(),
  addTaskDependencyAction: vi.fn(),
  removeTaskDependencyAction: vi.fn(),
  unarchiveTaskAction: vi.fn(),
  updateTaskInlineAction: vi.fn(),
  updateTaskFieldAction: vi.fn(),
  updateTaskFieldDraftAction: vi.fn(),
  bulkTaskFieldAction: vi.fn(),
  bulkTaskArchiveAction: vi.fn(),
}));

vi.mock("@/lib/task-subtask-actions", () => ({
  TASK_SUBTASK_ACTIONS: {
    addAction: vi.fn(),
    toggleAction: vi.fn(),
    renameAction: vi.fn(),
    deleteAction: vi.fn(),
    moveAction: vi.fn(),
    promoteAction: vi.fn(),
  },
}));

vi.mock("@/lib/task-comment-actions", () => ({
  TASK_COMMENT_ACTIONS: {},
}));

vi.mock("@/components/tasks/drawer/task-drawer-host", () => ({
  TaskDrawerHost: () => <div data-testid="task-drawer-host" />,
}));

vi.mock("./task-inbox-panel", () => ({
  TaskInboxPanel: ({
    ideas,
  }: {
    ideas: Array<{ id: string; title: string }>;
  }) => (
    <div data-testid="task-inbox-panel">
      <input data-testid="task-inbox-capture" />
      {ideas.map((idea) => (
        <span key={idea.id}>{idea.title}</span>
      ))}
    </div>
  ),
}));

import type { TaskRecord } from "@/lib/services/task-service";
import type { TasksPageModel } from "../_lib/tasks-page-model";
import { TasksPageView } from "./TasksPageView";

function buildTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    title: "Draft weekly execution review",
    description: null,
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

function buildModel(overrides: Partial<TasksPageModel> = {}): TasksPageModel {
  const tasks = overrides.tasks ?? [buildTask()];
  const parsed = {
    activeTab: "active",
    activeStatus: null,
    activeDueFilter: "all",
    activeSort: "updated_desc",
    activeLayout: "list",
    activeDensity: "comfortable",
    activeCalendarView: "month",
    activeCalendarDate: null,
    activeCalendarDateField: "due",
    activeView: "active",
    activeBoardOrder: null,
    projectParam: null,
    goalParam: null,
    savedViewDefinitionFilters: {
      status: null,
      projectId: null,
      goalId: null,
      dueFilter: "all",
      sortValue: "updated_desc",
      activeTasks: false,
      priorityValues: [],
      estimateMinMinutes: null,
      estimateMaxMinutes: null,
      dueWithinDays: null,
    },
    view: {
      version: 2,
      filters: [],
      groupBy: "none",
      sort: { key: "updated", direction: "desc" },
      search: "",
      activeOnly: false,
    },
    taskUpdateError: null,
    taskUpdateSuccess: null,
    taskUpdateTaskId: null,
    savedViewFeedback: { error: null, success: null },
  };

  return {
    parsed,
    projects: [{ id: "project-1", name: "EGA House" }],
    goals: [],
    tasks,
    taskTotalDurations: {},
    summary: { total: tasks.length, active: tasks.length, archived: 0 },
    savedViews: [],
    activeProjectId: null,
    activeGoalId: null,
    returnPath: "/tasks",
    taskUrlFilters: {
      filters: [],
      group: "none",
      q: "",
      sortKey: "updated",
      sortDirection: "desc",
      activeTasks: false,
      density: null,
      boardOrder: null,
      columns: undefined,
      cal: "month",
      date: null,
      dateField: "due",
    },
    kanbanBoard: { columns: [], tasksByStatus: {} },
    calendar: null,
    inProgressCount: 0,
    blockedCount: 0,
    overdueCount: 0,
    dueSoonCount: 0,
    groups: [],
    filteredTotal: tasks.length,
    loadedCount: tasks.length,
    truncated: false,
    timeline: null,
    timelineRange: { start: "2026-05-01", end: "2026-05-07" },
    timelineZoom: "week",
    ownerToday: "2026-05-01",
    selectedTaskId: null,
    selectedTaskMode: "panel",
    selectedTask: null,
    selectedTaskError: false,
    selectedTaskSubtasks: [],
    selectedTaskAttachments: { data: [], errorMessage: null },
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
    selectedTaskPlanning: null,
    subtaskCounts: {},
    inboxIdeas: [],
    inboxIdeasError: null,
    inboxProjects: [],
    ...overrides,
  } as unknown as TasksPageModel;
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

async function render(model: TasksPageModel) {
  await act(async () => {
    root.render(<TasksPageView model={model} />);
  });
}

function link(label: string) {
  return Array.from(container.querySelectorAll("a")).find(
    (anchor) => anchor.textContent?.trim() === label,
  );
}

describe("TasksPageView lean tabs", () => {
  it("renders Active, Inbox and Archived tabs with URL-authoritative scopes", async () => {
    await render(buildModel());

    expect(link("Active")?.getAttribute("href")).toBe("/tasks");
    expect(link("Inbox")?.getAttribute("href")).toBe("/tasks?tab=inbox");
    expect(link("Archived")?.getAttribute("href")).toBe(
      "/tasks?archive=archived",
    );
    expect(link("Active")?.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector('[data-testid="task-filter-bar"]')).not.toBeNull();
  });

  it("shows inline Restore on the Archived tab only", async () => {
    await render(
      buildModel({
        parsed: {
          ...buildModel().parsed,
          activeTab: "archived",
          activeView: "archived",
        },
        tasks: [buildTask({ id: "task-done", status: "done", archived_at: "2026-05-02" })],
      }),
    );

    expect(
      container.querySelector('[data-testid="task-restore-task-done"]'),
    ).not.toBeNull();
    expect(link("Archived")?.getAttribute("aria-current")).toBe("page");
  });

  it("shows pre-task capture and no filter bar on the Inbox tab", async () => {
    await render(
      buildModel({
        parsed: { ...buildModel().parsed, activeTab: "inbox" },
        inboxIdeas: [
          {
            id: "idea-1",
            title: "Explore onboarding insight",
            body: null,
            status: "inbox",
            type: "idea",
            project_id: null,
            priority: null,
            tags: [],
            created_at: "2026-05-01T09:00:00.000Z",
            updated_at: "2026-05-01T09:00:00.000Z",
            projects: null,
          },
        ],
        inboxProjects: [{ id: "project-1", name: "EGA House" }],
      }),
    );

    expect(
      container.querySelector('[data-testid="task-inbox-capture"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="task-filter-bar"]')).toBeNull();
    expect(container.textContent).toContain("Explore onboarding insight");
    expect(link("Inbox")?.getAttribute("aria-current")).toBe("page");
  });
});
