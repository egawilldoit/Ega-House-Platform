import { describe, expect, it } from "vitest";

import { getJobSearchReferenceOptions } from "./job-search-reference-options";

type QueryCall = {
  table: string;
  select: string | null;
  eq: Array<[string, unknown]>;
  order: Array<[string, unknown]>;
  range: [number, number] | null;
};

function createSupabaseMock(options: {
  tasks?: unknown[] | null;
  error?: { message: string } | null;
}) {
  const calls: QueryCall[] = [];

  function query(table: string) {
    const call: QueryCall = { table, select: null, eq: [], order: [], range: null };
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
      range(start: number, end: number) {
        call.range = [start, end];
        return chain;
      },
      then(resolve: (value: { data: unknown[] | null; error: { message: string } | null }) => void) {
        resolve({
          data: options.error ? null : (options.tasks ?? []).slice(call.range?.[0] ?? 0, (call.range?.[1] ?? 999) + 1),
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
  it("reads owner-scoped tasks including archived rows", async () => {
    const supabase = createSupabaseMock({
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
    expect(result.data.tasks).toEqual([
      { id: "t1", title: "Apply to roles", archivedAt: null },
      { id: "t2", title: "Old applications", archivedAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const call = supabase.calls[0];
    expect(call?.table).toBe("tasks");
    expect(call?.select).toBe("id, title, archived_at");
    expect(call?.eq).toContainEqual(["owner_user_id", "owner-1"]);
    expect(call?.order).toContainEqual(["updated_at", { ascending: false }]);
    expect(call?.range).toEqual([0, 499]);
  });

  it("includes tasks beyond the first page", async () => {
    const tasks = Array.from({ length: 501 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, archived_at: null }));
    const supabase = createSupabaseMock({ tasks });
    const result = await getJobSearchReferenceOptions({ supabase: supabase as never, getCurrentUser: async () => ({ id: "owner-1" }) });
    expect(result.data.tasks).toHaveLength(501);
    expect(supabase.calls[1]?.range).toEqual([500, 999]);
  });

  it("returns empty options plus an actionable error when the read fails", async () => {
    const supabase = createSupabaseMock({ error: { message: "boom" } });

    const result = await getJobSearchReferenceOptions({
      supabase: supabase as never,
      getCurrentUser: async () => ({ id: "owner-1" }),
    });

    expect(result.data).toEqual({ tasks: [] });
    expect(result.errorMessage).toMatch(/could not load job-search tasks/i);
  });

  it("returns empty options for an unauthenticated caller", async () => {
    const supabase = createSupabaseMock({});

    const result = await getJobSearchReferenceOptions({
      supabase: supabase as never,
      getCurrentUser: async () => null,
    });

    expect(result.data).toEqual({ tasks: [] });
    expect(result.errorMessage).toMatch(/sign in/i);
  });
});
