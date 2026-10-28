import { describe, expect, it } from "vitest";

import {
  DEEP_WORK_SAVED_VIEW_DEFINITION,
  getTaskSavedViewDefinitionFromFilters,
  getTaskSavedViewLegacyColumns,
  getTaskSavedViewFiltersFromDefinition,
  getTaskViewFromSavedView,
  normalizeTaskSavedViewDefinition,
  serializeTaskSavedViewDefinition,
  validateTaskViewScope,
  type TaskSavedViewFilters,
} from "./task-saved-views";

const scope = {
  projectIds: new Set(["project-1"]),
  goalsById: new Map([["goal-1", { id: "goal-1", projectId: "project-1" }]]),
};

describe("EGA-791 saved view definitions", () => {
  it("migrates a version 1 definition and merges legacy scope columns", () => {
    const view = getTaskViewFromSavedView({
      definitionJson: {
        version: 1,
        filters: { activeTasks: true, priority: ["urgent", "high"], estimateMinMinutes: 30 },
      },
      status: "in_progress",
      projectId: "project-1",
      goalId: "goal-1",
      dueFilter: "overdue",
      sortValue: "due_date_desc",
    });

    expect(view.version).toBe(2);
    expect(view.activeOnly).toBe(true);
    expect(view.sort).toEqual({ key: "due", direction: "desc" });
    expect(view.filters).toEqual([
      { field: "status", operator: "is", values: ["in_progress"] },
      { field: "priority", operator: "is_any_of", values: ["urgent", "high"] },
      { field: "project", operator: "is", values: ["project-1"] },
      { field: "goal", operator: "is", values: ["goal-1"] },
      { field: "due_bucket", operator: "is", values: ["overdue"] },
      { field: "estimate", operator: "between", values: ["30", ""] },
    ]);
  });

  it("loads rows that predate definition_json from the legacy columns", () => {
    const view = getTaskViewFromSavedView({
      definitionJson: null,
      status: "blocked",
      projectId: "project-1",
      goalId: null,
      dueFilter: "due_today",
      sortValue: "due_date_asc",
    });

    expect(view.filters).toEqual([
      { field: "status", operator: "is", values: ["blocked"] },
      { field: "project", operator: "is", values: ["project-1"] },
      { field: "due_bucket", operator: "is", values: ["today"] },
    ]);
    expect(view.sort).toEqual({ key: "due", direction: "asc" });
  });

  it("keeps a version 2 definition authoritative over legacy columns", () => {
    const view = getTaskViewFromSavedView({
      definitionJson: {
        version: 2,
        filters: [{ field: "status", operator: "is_none_of", values: ["done"] }],
        groupBy: "priority",
        sort: { key: "title", direction: "desc" },
        search: "launch",
        activeOnly: true,
      },
      status: "blocked",
      projectId: "project-1",
      dueFilter: "overdue",
      sortValue: "due_date_asc",
    });

    expect(view.filters).toEqual([
      { field: "status", operator: "is_none_of", values: ["done"] },
    ]);
    expect(view.groupBy).toBe("priority");
    expect(view.search).toBe("launch");
  });

  it("ignores unknown or corrupt definitions and falls back to legacy columns", () => {
    const view = getTaskViewFromSavedView({
      definitionJson: { version: 9, filters: [] },
      status: "todo",
      projectId: null,
      goalId: null,
      dueFilter: "all",
      sortValue: "updated_desc",
    });

    expect(view.filters).toEqual([{ field: "status", operator: "is", values: ["todo"] }]);
  });

  it("round-trips legacy filters into a v2 definition with legacy columns", () => {
    const filters: TaskSavedViewFilters = {
      status: "in_progress",
      projectId: "project-1",
      goalId: null,
      dueFilter: "due_soon",
      sortValue: "due_date_asc",
      activeTasks: true,
      priorityValues: ["urgent", "high"],
      estimateMinMinutes: 30,
      estimateMaxMinutes: 120,
      dueWithinDays: null,
    };

    const definition = getTaskSavedViewDefinitionFromFilters(filters);
    const projection = getTaskSavedViewFiltersFromDefinition(definition);
    expect(projection.status).toBe("in_progress");
    expect(projection.projectId).toBe("project-1");
    expect(projection.priorityValues).toEqual(["urgent", "high"]);
    expect(projection.estimateMinMinutes).toBe(30);
    expect(projection.estimateMaxMinutes).toBe(120);

    const columns = getTaskSavedViewLegacyColumns(definition);
    expect(columns.status).toBe("in_progress");
    expect(columns.projectId).toBe("project-1");
    expect(columns.sortValue).toBe("due_date_asc");
  });

  it("validates project/goal scope against the owner workspace", () => {
    const baseFilters: TaskSavedViewFilters = {
      status: null,
      projectId: "project-1",
      goalId: "goal-1",
      dueFilter: "all",
      sortValue: "updated_desc",
      activeTasks: false,
      priorityValues: [],
      estimateMinMinutes: null,
      estimateMaxMinutes: null,
      dueWithinDays: null,
    };

    expect(validateTaskViewScope(getTaskSavedViewDefinitionFromFilters(baseFilters), scope)).toBeNull();
    expect(
      validateTaskViewScope(
        getTaskSavedViewDefinitionFromFilters({ ...baseFilters, projectId: "other-project", goalId: null }),
        scope,
      ),
    ).toBe("Selected project is unavailable.");
    expect(
      validateTaskViewScope(
        getTaskSavedViewDefinitionFromFilters({ ...baseFilters, projectId: null }),
        { ...scope, goalsById: new Map() },
      ),
    ).toBe("Selected goal is unavailable.");
  });

  it("serializes built-in views within the contract bound", () => {
    const serialized = serializeTaskSavedViewDefinition(DEEP_WORK_SAVED_VIEW_DEFINITION);
    expect(serialized).not.toBeNull();
    expect(serialized!.length).toBeLessThanOrEqual(4096);
  });

  it("rejects oversized untrusted definitions", () => {
    expect(
      normalizeTaskSavedViewDefinition({
        version: 2,
        filters: [],
        search: "x".repeat(200),
      }),
    ).toBeNull();
  });
});
