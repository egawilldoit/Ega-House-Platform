// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/tasks/saved-views-actions", () => ({
  createTaskSavedViewAction: vi.fn(),
  deleteTaskSavedViewAction: vi.fn(),
  updateTaskSavedViewAction: vi.fn(),
}));

import { TaskViewToolbar } from "./task-view-toolbar";

const view = {
  version: 2 as const,
  filters: [
    { field: "status" as const, operator: "is" as const, values: ["in_progress"] },
    { field: "priority" as const, operator: "is" as const, values: ["urgent"] },
  ],
  groupBy: "status" as const,
  sort: { key: "title" as const, direction: "desc" as const },
  search: "launch",
  activeOnly: false,
};

function render() {
  return renderToStaticMarkup(
    React.createElement(TaskViewToolbar, {
      basePath: "/tasks",
      view,
      activeLayout: "list",
      activeDensity: "comfortable",
      activeView: "active",
      projectOptions: [{ id: "project-1", name: "EGA House" }],
      goalOptions: [],
      savedViews: [
        { id: "view-1", name: "Launch", href: "/tasks?filter=status%3Ais%3Atodo" },
      ],
      feedback: { error: null, success: null },
    }),
  );
}

describe("EGA-791 task view toolbar", () => {
  it("renders stackable chips, group/sort/search controls and their accessible names", () => {
    const markup = render();

    expect(markup).toContain("Filter");
    expect(markup).toContain("Status is In Progress");
    expect(markup).toContain("Priority is Urgent");
    expect(markup).toContain("Search: launch");
    expect(markup).toContain("Group: Status");
    expect(markup).toContain("Sort: Title");
    expect(markup).toContain("Sort direction: descending");
    expect(markup).toContain('aria-label="Remove Status is In Progress filter"');
    expect(markup).toContain('aria-label="Edit filter Status is In Progress"');
    expect(markup).toContain('type="search"');
    expect(markup).toContain("Views");
    expect(markup).toContain("Save view");
  });

  it("exposes a save-view entry point without replacing the current URL state", () => {
    const markup = render();

    expect(markup).toContain('aria-label="Save current view"');
    expect(markup).toContain('aria-haspopup="dialog"');
  });

  it("keeps the current view in hidden search fields when the search form submits", () => {
    const markup = render();

    expect(markup).toContain('name="group" value="status"');
    expect(markup).toContain('name="sort" value="title"');
    expect(markup).toContain('name="dir" value="desc"');
    expect(markup).toContain('name="status" value="in_progress"');
    expect(markup).toContain('name="priority" value="urgent"');
  });
});
