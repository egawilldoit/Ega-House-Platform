import { describe, expect, it } from "vitest";

import { parseTasksSearchParams } from "./tasks-page-model";

describe("Tasks workbench URL compatibility", () => {
  it("falls back a legacy saved-view deep link to the default Active list", () => {
    const parsed = parseTasksSearchParams({
      savedView: "default:deep-work",
      view: "all",
      cols: "task,project",
      widths: "project:320",
    });

    expect(parsed.activeTab).toBe("active");
    expect(parsed.activeView).toBe("active");
    // Legacy column state is still parsed, but the lean list simply ignores it.
    expect(parsed.view.columns?.length).toBeGreaterThan(0);
  });

  it("maps the legacy archive scope onto the Archived tab", () => {
    expect(parseTasksSearchParams({ archive: "archived" }).activeTab).toBe(
      "archived",
    );
    expect(parseTasksSearchParams({ view: "archived" }).activeView).toBe(
      "archived",
    );
  });

  it("honors the canonical tab parameter over legacy view state", () => {
    expect(
      parseTasksSearchParams({ tab: "inbox", view: "archived" }).activeTab,
    ).toBe("inbox");
    expect(parseTasksSearchParams({ tab: "archived" }).activeTab).toBe(
      "archived",
    );
    expect(parseTasksSearchParams({ tab: "active" }).activeView).toBe("active");
  });

  it("never throws on unknown tabs or saved-view ids", () => {
    expect(() =>
      parseTasksSearchParams({
        tab: "saved:something",
        savedView: "../etc/passwd",
        status: "done",
      }),
    ).not.toThrow();
    expect(parseTasksSearchParams({ tab: "saved:something" }).activeTab).toBe(
      "active",
    );
  });
});
