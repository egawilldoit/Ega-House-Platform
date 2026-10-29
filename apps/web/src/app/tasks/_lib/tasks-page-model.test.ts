import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const getTasksWorkspaceData = vi.hoisted(() =>
  vi.fn(async () => ({
    projects: [],
    goals: [],
    tasks: mockTasks,
    taskTotalDurations: {},
    summary: { total: 0, active: 0, archived: 0 },
    savedViews: [],
    savedViewsUnavailable: false,
    activeProjectId: null,
    activeGoalId: null,
    calendar: null,
  })),
);

const mockTasks = vi.hoisted(() => [
  {
    id: "overdue-task",
    due_date: "2026-05-01",
    status: "todo",
  },
  {
    id: "due-soon-task",
    due_date: "2026-05-08",
    status: "todo",
  },
  {
    id: "done-task",
    due_date: "2026-05-01",
    status: "done",
  },
]);

vi.mock("@/lib/services/task-service", () => ({
  getTasksWorkspaceData,
  getTaskDrawerDetail: vi.fn(async () => ({ kind: "unavailable" })),
}));

vi.mock("@/lib/services/favorite-service", () => ({
  isFavorite: vi.fn(async () => false),
}));

vi.mock("@/lib/services/task-activity-service", () => ({
  getTaskActivity: vi.fn(async () => ({ items: [], hasMore: false, errorMessage: null })),
}));

vi.mock("@/lib/services/task-comment-service", () => ({
  getTaskCommentThread: vi.fn(async () => ({
    comments: [],
    mentionCandidates: [],
    errorMessage: null,
  })),
}));

vi.mock("@/lib/services/subtask-service", () => ({
  listTaskSubtasks: vi.fn(async () => ({ data: [], errorMessage: null })),
  getSubtaskCountsForTasks: vi.fn(async () => ({})),
}));

const getWebTimeContext = vi.hoisted(() =>
  vi.fn(async () => ({
    timezone: "Asia/Tokyo",
    persistedTimezone: "Asia/Tokyo",
    fallback: "none",
    localDate: "2026-05-03",
  })),
);

vi.mock("@/lib/services/time-context-service", () => ({ getWebTimeContext }));

import { getTasksPageModel } from "./tasks-page-model";

const LIVE_MODEL_KEYS = [
  "parsed",
  "projects",
  "goals",
  "tasks",
  "taskTotalDurations",
  "summary",
  "savedViews",
  "activeProjectId",
  "activeGoalId",
  "returnPath",
  "taskUrlFilters",
  "kanbanBoard",
  "calendar",
  "inProgressCount",
  "blockedCount",
  "overdueCount",
  "dueSoonCount",
] as const;

const REMOVED_MODEL_KEYS = [
  "focusQueue",
  "resolvedSavedViewFeedback",
  "calendarFormDefaults",
] as const;

describe("getTasksPageModel dead /tasks work removal", () => {
  it("does not compute or return the removed fields", async () => {
    const model = await getTasksPageModel({});

    for (const key of REMOVED_MODEL_KEYS) {
      expect(model, key).not.toHaveProperty(key);
    }
  });

  it("still returns every live list/board/summary/filter field", async () => {
    const model = await getTasksPageModel({});

    for (const key of LIVE_MODEL_KEYS) {
      expect(model, key).toHaveProperty(key);
    }
  });

  it("loads the workspace data exactly once", async () => {
    getTasksWorkspaceData.mockClear();
    await getTasksPageModel({});
    expect(getTasksWorkspaceData).toHaveBeenCalledTimes(1);
  });

  it("passes the validated calendar window and owner timezone to the bounded read", async () => {
    getTasksWorkspaceData.mockClear();
    const model = await getTasksPageModel({
      layout: "calendar",
      cal: "week",
      date: "2026-05-06",
      dateField: "planned",
    });

    expect(model.parsed.activeLayout).toBe("calendar");
    expect(model.parsed.activeCalendarView).toBe("week");
    expect(model.parsed.activeCalendarDate).toBe("2026-05-06");
    expect(model.parsed.activeCalendarDateField).toBe("planned");
    expect(getTasksWorkspaceData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        todayIsoDate: "2026-05-03",
        calendar: {
          view: "week",
          dateField: "planned",
          anchorDate: "2026-05-06",
          timezone: "Asia/Tokyo",
        },
      }),
    );
  });

  it("ignores an invalid calendar anchor instead of querying a broken range", async () => {
    getTasksWorkspaceData.mockClear();
    const model = await getTasksPageModel({
      layout: "calendar",
      date: "2026-02-30",
    });

    expect(model.parsed.activeCalendarDate).toBeNull();
    expect(getTasksWorkspaceData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        calendar: expect.objectContaining({ anchorDate: "2026-05-03" }),
      }),
    );
  });

  it("keeps saved-view data available without resolving feedback the UI never reads", async () => {
    const model = await getTasksPageModel({});

    expect(model.savedViews).toEqual([]);
    expect(model).not.toHaveProperty("resolvedSavedViewFeedback");
  });

  it("EGA-792: parses bounded column state and carries it in the view URL", async () => {
    const model = await getTasksPageModel({
      cols: "task,project,status",
      widths: "status:400",
    });

    expect(
      model.parsed.view.columns
        ?.filter((column) => column.visible)
        .map((column) => column.id),
    ).toEqual(["task", "project", "status"]);
    expect(model.returnPath).toContain("cols=task%2Cproject%2Cstatus");
    expect(model.returnPath).toContain("widths=status%3A400");

    const defaultModel = await getTasksPageModel({});
    expect(defaultModel.parsed.view.columns).toBeUndefined();
  });

  it("ega-661: overdue and due-soon counts use the account local date, not the runtime-local date", async () => {
    const model = await getTasksPageModel({});

    expect(model.overdueCount).toBe(1);
    expect(model.dueSoonCount).toBe(1);
  });

  it("uses the durable default layout only when the view has no explicit layout", async () => {
    const preferred = await getTasksPageModel({}, { defaultLayout: "kanban" });
    expect(preferred.parsed.activeLayout).toBe("kanban");
    expect(preferred.returnPath).toContain("layout=kanban");

    const explicit = await getTasksPageModel({ layout: "list" }, { defaultLayout: "kanban" });
    expect(explicit.parsed.activeLayout).toBe("list");

    const unsupported = await getTasksPageModel(
      { layout: "table" },
      { defaultLayout: "kanban" },
    );
    expect(unsupported.parsed.activeLayout).toBe("kanban");
  });

  it("never requests calendar integration settings or sorts a focus queue in the model", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/tasks/_lib/tasks-page-model.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/getCalendarIntegrationSettings/);
    expect(source).not.toMatch(/getCalendarTaskFormDefaults/);
    expect(source).not.toMatch(/sortFocusQueueTasks/);
    expect(source).not.toMatch(/focusQueue/);
    expect(source).not.toMatch(/resolvedSavedViewFeedback/);
  });
});
