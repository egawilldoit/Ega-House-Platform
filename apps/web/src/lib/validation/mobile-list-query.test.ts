import { describe, expect, it } from "vitest";

import { validateMobileTaskListQuery } from "@/lib/validation/mobile";

function buildQuery(params: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(params);
  return validateMobileTaskListQuery(searchParams);
}

describe("validateMobileTaskListQuery", () => {
  it("accepts an empty query with server defaults", () => {
    const result = buildQuery();

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: null,
        projectId: null,
        goalId: null,
        priority: null,
        due: "all",
        sort: "updated_desc",
        limit: null,
      },
    });
  });

  it("accepts a canonical priority filter", () => {
    expect(buildQuery({ priority: "urgent" })).toMatchObject({
      ok: true,
      data: expect.objectContaining({ priority: "urgent" }),
    });
    expect(buildQuery({ priority: "low" })).toMatchObject({
      ok: true,
      data: expect.objectContaining({ priority: "low" }),
    });
  });

  it("rejects a non-canonical priority filter", () => {
    const result = buildQuery({ priority: "asap" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error.message).toBe("Invalid priority filter.");
    }
  });

  it("still rejects invalid status and limit values alongside the new filter", () => {
    expect(buildQuery({ status: "archived" }).ok).toBe(false);
    expect(buildQuery({ limit: "0" }).ok).toBe(false);
    expect(buildQuery({ limit: "201" }).ok).toBe(false);
  });

  it("keeps existing filters intact when priority is absent", () => {
    expect(
      buildQuery({ status: "todo", projectId: "p-1", goalId: "g-1", due: "overdue", sort: "due_date_asc", limit: "50" }),
    ).toMatchObject({
      ok: true,
      data: {
        status: "todo",
        projectId: "p-1",
        goalId: "g-1",
        priority: null,
        due: "overdue",
        sort: "due_date_asc",
        limit: 50,
      },
    });
  });
});
