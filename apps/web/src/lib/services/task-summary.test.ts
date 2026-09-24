import { describe, expect, it } from "vitest";

import { getTasksSummary } from "./task-service";

type CountResult = {
  count: number | null;
  error: { code?: string; message?: string } | null;
};

type RecordedCall = {
  table: string;
  columns: unknown;
  options: unknown;
  filter: { column: string; value: unknown } | null;
};

/**
 * Minimal thenable/chainable stand-in for the two count-only queries
 * `getTasksSummary` issues. It records the query shape so a test can assert the
 * full-row `archived_at` read is gone.
 */
function createSummaryClient(config: { total?: CountResult; active?: CountResult }) {
  const calls: RecordedCall[] = [];

  const from = (table: string) => ({
    select(columns: unknown, options: unknown) {
      const call: RecordedCall = { table, columns, options, filter: null };
      calls.push(call);

      const thenable = {
        is(column: string, value: unknown) {
          call.filter = { column, value };
          return thenable;
        },
        then(onFulfilled: (value: CountResult) => unknown, onRejected?: (reason: unknown) => unknown) {
          const result = call.filter
            ? config.active ?? { count: 0, error: null }
            : config.total ?? { count: 0, error: null };
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };

      return thenable;
    },
  });

  return { client: { from } as never, calls };
}

const missingArchivedAtError = {
  code: "PGRST204",
  message: "Could not find the 'archived_at' column of 'public.tasks' in the schema cache",
};

describe("getTasksSummary", () => {
  it("returns total, active and derived archived counts", async () => {
    const { client } = createSummaryClient({
      total: { count: 5, error: null },
      active: { count: 3, error: null },
    });

    await expect(getTasksSummary(client)).resolves.toEqual({
      total: 5,
      active: 3,
      archived: 2,
      unavailable: false,
    });
  });

  it("handles zero tasks", async () => {
    const { client } = createSummaryClient({
      total: { count: 0, error: null },
      active: { count: 0, error: null },
    });

    await expect(getTasksSummary(client)).resolves.toEqual({
      total: 0,
      active: 0,
      archived: 0,
      unavailable: false,
    });
  });

  it("handles a single active task", async () => {
    const { client } = createSummaryClient({
      total: { count: 1, error: null },
      active: { count: 1, error: null },
    });

    await expect(getTasksSummary(client)).resolves.toEqual({
      total: 1,
      active: 1,
      archived: 0,
      unavailable: false,
    });
  });

  it("handles an all-archived set", async () => {
    const { client } = createSummaryClient({
      total: { count: 4, error: null },
      active: { count: 0, error: null },
    });

    await expect(getTasksSummary(client)).resolves.toEqual({
      total: 4,
      active: 0,
      archived: 4,
      unavailable: false,
    });
  });

  it("uses count-only HEAD queries and never reads task rows", async () => {
    const { client, calls } = createSummaryClient({
      total: { count: 7, error: null },
      active: { count: 7, error: null },
    });

    await getTasksSummary(client);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.table).toBe("tasks");
      expect(call.columns).toBe("id");
      expect(call.options).toEqual({ count: "exact", head: true });
      expect(String(call.columns)).not.toContain("archived_at");
    }
    expect(calls[1].filter).toEqual({ column: "archived_at", value: null });
  });

  it("reports unavailable when the archived_at column is missing", async () => {
    const { client } = createSummaryClient({
      total: { count: 0, error: null },
      active: { count: null, error: missingArchivedAtError },
    });

    await expect(getTasksSummary(client)).resolves.toEqual({
      total: 0,
      active: 0,
      archived: 0,
      unavailable: true,
    });
  });

  it("throws for unrelated summary failures", async () => {
    const { client } = createSummaryClient({
      total: { count: null, error: { code: "XX000", message: "boom" } },
      active: { count: 0, error: null },
    });

    await expect(getTasksSummary(client)).rejects.toThrow("Failed to load task summary");
  });
});
