import { describe, expect, it } from "vitest";

import { verifyJobSearchReferenceTask } from "./job-search-reference-service";

function createSupabaseMock(options: {
  data?: { id: string } | null;
  error?: { message: string } | null;
}) {
  const calls: Array<{ table: string; select: string | null; eq: Array<[string, unknown]> }> = [];

  return {
    calls,
    from(table: string) {
      const call = { table, select: null as string | null, eq: [] as Array<[string, unknown]> };
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
        maybeSingle() {
          return Promise.resolve({ data: options.data ?? null, error: options.error ?? null });
        },
      };
      return chain;
    },
  };
}

describe("verifyJobSearchReferenceTask", () => {
  it("accepts an owned task and filters by both id and owner", async () => {
    const supabase = createSupabaseMock({ data: { id: "task-1" } });

    const result = await verifyJobSearchReferenceTask({
      taskId: "task-1",
      supabase: supabase as never,
      getCurrentUser: async () => ({ id: "owner-1" }),
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(supabase.calls[0]?.table).toBe("tasks");
    expect(supabase.calls[0]?.select).toBe("id");
    expect(supabase.calls[0]?.eq).toContainEqual(["id", "task-1"]);
    expect(supabase.calls[0]?.eq).toContainEqual(["owner_user_id", "owner-1"]);
  });

  it("rejects an unknown or foreign task id", async () => {
    const supabase = createSupabaseMock({ data: null });

    const result = await verifyJobSearchReferenceTask({
      taskId: "foreign-task",
      supabase: supabase as never,
      getCurrentUser: async () => ({ id: "owner-1" }),
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/not available/i);
  });

  it("fails closed when the ownership read fails", async () => {
    const supabase = createSupabaseMock({ error: { message: "boom" } });

    const result = await verifyJobSearchReferenceTask({
      taskId: "task-1",
      supabase: supabase as never,
      getCurrentUser: async () => ({ id: "owner-1" }),
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/unable to verify/i);
  });

  it("rejects an unauthenticated caller", async () => {
    const supabase = createSupabaseMock({ data: { id: "task-1" } });

    const result = await verifyJobSearchReferenceTask({
      taskId: "task-1",
      supabase: supabase as never,
      getCurrentUser: async () => null,
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/sign in/i);
  });
});
