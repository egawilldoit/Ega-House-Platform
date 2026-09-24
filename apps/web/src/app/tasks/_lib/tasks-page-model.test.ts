import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const getTasksWorkspaceData = vi.hoisted(() =>
  vi.fn(async () => ({
    projects: [],
    goals: [],
    tasks: [],
    taskTotalDurations: {},
    summary: { total: 0, active: 0, archived: 0 },
    savedViews: [],
    savedViewsUnavailable: false,
    activeProjectId: null,
    activeGoalId: null,
  })),
);

vi.mock("@/lib/services/task-service", () => ({ getTasksWorkspaceData }));

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

  it("keeps saved-view data available without resolving feedback the UI never reads", async () => {
    const model = await getTasksPageModel({});

    expect(model.savedViews).toEqual([]);
    expect(model).not.toHaveProperty("resolvedSavedViewFeedback");
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
