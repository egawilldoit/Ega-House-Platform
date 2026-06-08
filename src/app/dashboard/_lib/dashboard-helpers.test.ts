import { describe, it, expect } from "vitest";

import {
  getGreeting,
  getHeroSummary,
  toPreviewText,
  getTaskContextHref,
  getTodayWindow,
  displayNameForUser,
} from "./dashboard-helpers";

describe("getGreeting", () => {
  it("returns a string", () => {
    expect(typeof getGreeting()).toBe("string");
  });

  it("is one of the three known greetings", () => {
    const greeting = getGreeting();
    expect(["Good morning", "Good afternoon", "Good evening"]).toContain(greeting);
  });
});

describe("getHeroSummary", () => {
  it("returns the empty-state copy when there are no tasks", () => {
    const summary = getHeroSummary(0, null);
    expect(summary).toContain("No work is in today's lane yet");
  });

  it("uses singular 'task' when count is 1", () => {
    const summary = getHeroSummary(1, null);
    expect(summary).toContain("1 task in today's lane");
    expect(summary).not.toContain("1 tasks");
  });

  it("uses plural 'tasks' when count is not 1", () => {
    const summary = getHeroSummary(3, null);
    expect(summary).toContain("3 tasks in today's lane");
  });

  it("appends completion rate when provided", () => {
    expect(getHeroSummary(2, 50)).toContain("50% done");
  });

  it("omits completion suffix when null", () => {
    expect(getHeroSummary(2, null)).not.toContain("% done");
  });
});

describe("toPreviewText", () => {
  it("returns the empty-state copy for null", () => {
    expect(toPreviewText(null)).toBe("No summary recorded yet.");
  });

  it("returns the empty-state copy for undefined", () => {
    expect(toPreviewText(undefined)).toBe("No summary recorded yet.");
  });

  it("returns the empty-state copy for empty string", () => {
    expect(toPreviewText("")).toBe("No summary recorded yet.");
  });

  it("returns the value when it fits within the max", () => {
    expect(toPreviewText("short", 200)).toBe("short");
  });

  it("truncates and adds ellipsis when too long", () => {
    const long = "a".repeat(300);
    const out = toPreviewText(long, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith("…")).toBe(true);
  });

  it("trims whitespace before checking length", () => {
    expect(toPreviewText("   hi   ", 10)).toBe("hi");
  });
});

describe("getTaskContextHref", () => {
  it("returns /tasks when projectSlug is null", () => {
    expect(getTaskContextHref("abc", null)).toBe("/tasks");
  });

  it("returns /tasks when projectSlug is undefined", () => {
    expect(getTaskContextHref("abc", undefined)).toBe("/tasks");
  });

  it("returns the project anchor href when slug is provided", () => {
    expect(getTaskContextHref("abc", "my-project")).toBe(
      "/tasks/projects/my-project#task-abc",
    );
  });
});

describe("getTodayWindow", () => {
  it("returns startIso before endIso on the same day", () => {
    const { startIso, endIso } = getTodayWindow();
    expect(new Date(startIso).getTime()).toBeLessThan(new Date(endIso).getTime());
  });

  it("startIso is at midnight", () => {
    const { startIso } = getTodayWindow();
    const d = new Date(startIso);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it("endIso is on the next calendar day", () => {
    const { startIso, endIso } = getTodayWindow();
    const start = new Date(startIso);
    const end = new Date(endIso);
    expect(end.getDate()).not.toBe(start.getDate());
  });
});

describe("displayNameForUser", () => {
  it("returns 'operator' for null", () => {
    expect(displayNameForUser(null)).toBe("operator");
  });

  it("returns 'operator' for undefined", () => {
    expect(displayNameForUser(undefined)).toBe("operator");
  });

  it("returns 'operator' when user has no metadata and no email", () => {
    expect(displayNameForUser({})).toBe("operator");
  });

  it("prefers user_metadata.display_name", () => {
    expect(
      displayNameForUser({
        user_metadata: { display_name: "Ada" },
        email: "ada@example.com",
      }),
    ).toBe("Ada");
  });

  it("falls back to user_metadata.full_name", () => {
    expect(
      displayNameForUser({
        user_metadata: { full_name: "Grace Hopper" },
      }),
    ).toBe("Grace Hopper");
  });

  it("falls back to user_metadata.name", () => {
    expect(
      displayNameForUser({
        user_metadata: { name: "Linus" },
      }),
    ).toBe("Linus");
  });

  it("falls back to email local-part when no metadata", () => {
    expect(displayNameForUser({ email: "rich@example.com" })).toBe("rich");
  });

  it("returns 'operator' when email has no local part", () => {
    expect(displayNameForUser({ email: "@example.com" })).toBe("operator");
  });

  it("ignores empty/whitespace metadata values and falls through", () => {
    expect(
      displayNameForUser({
        user_metadata: { display_name: "   ", full_name: "" },
        email: "fallback@example.com",
      }),
    ).toBe("fallback");
  });
});
