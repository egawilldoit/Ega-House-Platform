import { describe, expect, it } from "vitest";

import { getJobSearchReferenceOptions } from "./job-search-reference-options";

type QueryCall = {
  table: string;
  select: string | null;
  eq: Array<[string, unknown]>;
  order: Array<[string, unknown]>;
  limit: number | null;
};

function createSupabaseMock(options: {
  projects?: unknown[] | null;
  tasks?: unknown[] | null;
  error?: { message: string } | null;
}) {
  const calls: QueryCall[] = [];

  function query(table: string) {
    const call: QueryCall = { table, select: null, eq: [], order: [], limit: null };
    calls.push(call);
    const chain = {
      select(columns: string) {
        call.select = columns;
        return chain;
      },
      eq(column: string, value: unknown) {
        call.eq.push([column, value]);
        return chain;
      },
      order(column: string, opts: unknown) {
        call.order.push([column, opts]);
        return chain;
      },
      limit(value: number) {
        call.limit = value;
        return chain;
      },
      then(resolve: (value: { data: unknown[] | null; error: { message: string } | null }) => void) {
        resolve({
          data: options.error ? null : table === "projects" ? options.projects ?? [] : options.tasks ?? [],
          error: options.error ?? null,
        });
      },
    };
    return chain;
  }

  return {
    calls,
    from(table: string) {
      return query(table);
    },
  };
}

describe("getJobSearchReferenceOptions", () => {
  it("reads projects and tasks with an explicit owner filter", async () => {
    const supabase = createSupabaseMock({
      projects: [{ id: "p1", name: "Career" }],
      tasks: [
        { id: "t1", title: "Apply to roles", archived_at: null },
        { id: "t2", title: "Old applications", archived_at: "2026-01-01T00:00:00.000Z" },
      ],
    });

    const result = await getJobSearchReferenceOptions({
      supabase: supabase as never,
      getCurrentUser: async () => ({ id: "owner-1" }),
    });

    expect(result.errorMessage).toBeNull();
    expect(result.data.projects).toEqual([{ id: "p1", name: "Career" }]);
    expect(result.data.tasks).toEqual([
      { id: "t1", title: "Apply to roles", archivedAt: null },
      { id: "t2", title: "Old applications", archivedAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const projectsCall = supabase.calls.find((call) => call.table === "projects");
    const tasksCall = supabase.calls.find((call) => call.table === "tasks");
    expect(projectsCall?.select).toBe("id, name");
    expect(tasksCall?.select).toBe("id, title, archived_at");
    for (const call of supabase.calls) {
      expect(call.eq).toContainEqual(["owner_user_id", "owner-1"]);
      expect(call.limit).toBe(200);
    }
    expect(tasksCall?.order).toContainEqual(["updated_at", { ascending: false }]);
  });

  it("returns empty options plus an actionable error when the read fails", async () => {
    const supabase = createSupabaseMock({ error: { message: "boom" } });

    const result = await getJobSearchReferenceOptions({
      supabase: supabase as never,
      getCurrentUser: async () => ({ id: "owner-1" }),
    });

    expect(result.data).toEqual({ projects: [], tasks: [] });
    expect(result.errorMessage).toMatch(/could not load job-search references/i);
  });

  it("returns empty options for an unauthenticated caller", async () => {
    const supabase = createSupabaseMock({});

    const result = await getJobSearchReferenceOptions({
      supabase: supabase as never,
      getCurrentUser: async () => null,
    });

    expect(result.data).toEqual({ projects: [], tasks: [] });
    expect(result.errorMessage).toMatch(/sign in/i);
  });
});
