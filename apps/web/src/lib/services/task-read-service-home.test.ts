import assert from "node:assert/strict";
import test from "node:test";

import {
  getHomeCompletedTaskPreview,
  getHomeDeadlinePreview,
  getHomeOverdueTaskPreview,
  getHomeUpcomingTaskPreview,
  getOpenTaskCount,
  getProjectDashboardCounts,
} from "./task-read-service";

type Row = Record<string, unknown>;
type Tables = { tasks: Row[]; projects?: Row[]; goals?: Row[] };

type FakeOptions = {
  errorTable?: string;
};

function matchesOr(row: Row, expression: string) {
  return expression.split(",").some((clause) => {
    const [column, operator, ...rest] = clause.trim().split(".");
    const value = rest.join(".");
    const rowValue = row[column] ?? null;

    if (operator === "is") {
      return value === "null" ? rowValue === null : String(rowValue) === value;
    }
    if (operator === "gte") {
      return typeof rowValue === "string" && rowValue >= value;
    }
    if (operator === "eq") {
      return String(rowValue) === value;
    }
    throw new Error(`Unsupported or() operator: ${operator}`);
  });
}

/** Minimal PostgREST-like fake with exact-count + bounded rows semantics. */
function createFakeDb(tables: Tables, options: FakeOptions = {}) {
  return {
    from(table: string) {
      return {
        select(_columns: string, selectOptions?: { count?: string; head?: boolean }) {
          assert.ok(table in tables, `Unexpected table ${table}`);
          const filters: Array<(row: Row) => boolean> = [];
          const orders: Array<{ column: string; ascending: boolean }> = [];
          let limit: number | null = null;

          const execute = () => {
            if (options.errorTable === table) {
              return { data: null, count: null, error: { message: "boom" } };
            }

            let rows = [...(tables[table as keyof Tables] ?? [])].filter((row) =>
              filters.every((filter) => filter(row)),
            );
            const count = rows.length;

            rows = rows.sort((left, right) => {
              for (const order of orders) {
                const leftValue = left[order.column] ?? null;
                const rightValue = right[order.column] ?? null;
                if (leftValue === rightValue) continue;
                if (leftValue === null) return 1;
                if (rightValue === null) return -1;
                const comparison = leftValue > rightValue ? 1 : -1;
                return order.ascending ? comparison : -comparison;
              }
              return 0;
            });

            if (limit !== null) rows = rows.slice(0, limit);

            if (selectOptions?.head) {
              return { data: null, count, error: null };
            }

            return { data: rows, count, error: null };
          };

          const query = {
            eq(column: string, value: unknown) {
              filters.push((row) => row[column] === value);
              return query;
            },
            neq(column: string, value: unknown) {
              filters.push((row) => row[column] !== value);
              return query;
            },
            is(column: string, value: null) {
              filters.push((row) => (row[column] ?? null) === value);
              return query;
            },
            gte(column: string, value: unknown) {
              filters.push(
                (row) => typeof row[column] === "string" && (row[column] as string) >= String(value),
              );
              return query;
            },
            lte(column: string, value: unknown) {
              filters.push(
                (row) => typeof row[column] === "string" && (row[column] as string) <= String(value),
              );
              return query;
            },
            lt(column: string, value: unknown) {
              filters.push(
                (row) => typeof row[column] === "string" && (row[column] as string) < String(value),
              );
              return query;
            },
            in(column: string, values: unknown[]) {
              filters.push((row) => values.includes(row[column]));
              return query;
            },
            or(expression: string) {
              filters.push((row) => matchesOr(row, expression));
              return query;
            },
            order(column: string, orderOptions?: { ascending?: boolean }) {
              orders.push({ column, ascending: orderOptions?.ascending ?? true });
              return query;
            },
            limit(value: number) {
              limit = value;
              return query;
            },
            then(resolve: (value: ReturnType<typeof execute>) => void) {
              resolve(execute());
            },
          };

          return query;
        },
      };
    },
  };
}

function task(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    owner_user_id: "user-1",
    title: `Task ${id}`,
    status: "todo",
    priority: "medium",
    due_date: null,
    completed_at: null,
    archived_at: null,
    updated_at: "2026-09-20T10:00:00.000Z",
    project_id: "project-1",
    projects: { name: "EGA House", slug: "ega-house" },
    ...overrides,
  };
}

test("EGA-805: open task count is an exact head count for the active scope", async () => {
  const db = createFakeDb({
    tasks: [
      task("a"),
      task("b", { status: "in_progress" }),
      task("c", { status: "done" }),
      task("d", { archived_at: "2026-09-01T00:00:00.000Z" }),
      task("e", { status: "blocked" }),
    ],
  });

  const result = await getOpenTaskCount({ ownerUserId: "user-1", supabase: db as never });
  assert.equal(result.errorMessage, null);
  assert.equal(result.count, 3);
});

test("EGA-805: deadline preview preserves the exact total beyond the preview cap", async () => {
  const db = createFakeDb({
    tasks: Array.from({ length: 25 }, (_, index) =>
      task(`t${index}`, { due_date: "2026-09-24" }),
    ),
  });

  const result = await getHomeDeadlinePreview({
    ownerUserId: "user-1",
    dueFrom: "2026-09-24",
    dueTo: "2026-09-24",
    limit: 4,
    supabase: db as never,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.count, 25);
  assert.equal(result.data?.rows.length, 4);
});

test("EGA-805: a reversed deadline window is a verified empty bucket", async () => {
  const db = createFakeDb({ tasks: [task("a", { due_date: "2026-09-29" })] });

  const result = await getHomeDeadlinePreview({
    ownerUserId: "user-1",
    dueFrom: "2026-09-29",
    dueTo: "2026-09-27",
    limit: 4,
    supabase: db as never,
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.data, { rows: [], count: 0 });
});

test("EGA-805: upcoming includes open tasks without a due date and excludes overdue work", async () => {
  const db = createFakeDb({
    tasks: [
      task("overdue", { due_date: "2026-09-20" }),
      task("today", { due_date: "2026-09-24" }),
      task("future", { due_date: "2026-10-01" }),
      task("no-date"),
      task("done", { status: "done", due_date: "2026-09-30" }),
      task("archived", { archived_at: "2026-09-01T00:00:00.000Z" }),
    ],
  });

  const result = await getHomeUpcomingTaskPreview({
    ownerUserId: "user-1",
    today: "2026-09-24",
    limit: 10,
    supabase: db as never,
  });

  assert.equal(result.data?.count, 3);
  assert.deepEqual(
    result.data?.rows.map((row) => row.id).sort(),
    ["future", "no-date", "today"],
  );
});

test("EGA-805: overdue preview only counts open, unarchived work", async () => {
  const db = createFakeDb({
    tasks: [
      task("overdue", { due_date: "2026-09-20" }),
      task("overdue-done", { due_date: "2026-09-20", status: "done" }),
      task("today", { due_date: "2026-09-24" }),
    ],
  });

  const result = await getHomeOverdueTaskPreview({
    ownerUserId: "user-1",
    today: "2026-09-24",
    limit: 10,
    supabase: db as never,
  });

  assert.equal(result.data?.count, 1);
  assert.equal(result.data?.rows[0]?.id, "overdue");
});

test("EGA-805: completed preview keeps archived completions in the total", async () => {
  const db = createFakeDb({
    tasks: [
      task("done", { status: "done", completed_at: "2026-09-24T10:00:00.000Z" }),
      task("archived-done", {
        status: "done",
        completed_at: "2026-09-23T10:00:00.000Z",
        archived_at: "2026-09-24T00:00:00.000Z",
      }),
      task("open"),
    ],
  });

  const result = await getHomeCompletedTaskPreview({
    ownerUserId: "user-1",
    limit: 1,
    supabase: db as never,
  });

  assert.equal(result.data?.count, 2);
  assert.equal(result.data?.rows.length, 1);
  assert.equal(result.data?.rows[0]?.id, "done");
});

test("EGA-805: project at-risk count uses Goal health inside the active project scope", async () => {
  const db = createFakeDb({
    tasks: [],
    projects: [
      { id: "p1", owner_user_id: "user-1", status: "active" },
      { id: "p2", owner_user_id: "user-1", status: "planned" },
      { id: "p3", owner_user_id: "user-1", status: "archived" },
    ],
    goals: [
      { id: "g1", owner_user_id: "user-1", project_id: "p1", health: "at_risk" },
      { id: "g2", owner_user_id: "user-1", project_id: "p1", health: "off_track" },
      { id: "g3", owner_user_id: "user-1", project_id: "p2", health: "at_risk" },
      { id: "g4", owner_user_id: "user-1", project_id: "p3", health: "at_risk" },
      { id: "g5", owner_user_id: "user-1", project_id: "p1", health: "on_track" },
    ],
  });

  const result = await getProjectDashboardCounts({
    ownerUserId: "user-1",
    supabase: db as never,
  });

  assert.deepEqual(result.data, { activeCount: 2, atRiskCount: 2 });
});

test("EGA-805: failed preview reads stay unavailable instead of empty", async () => {
  const db = createFakeDb(
    { tasks: [task("a", { due_date: "2026-09-24" })] },
    { errorTable: "tasks" },
  );

  const result = await getHomeDeadlinePreview({
    ownerUserId: "user-1",
    dueFrom: "2026-09-24",
    dueTo: "2026-09-24",
    limit: 4,
    supabase: db as never,
  });

  assert.equal(result.data, null);
  assert.equal(typeof result.errorMessage, "string");

  const count = await getOpenTaskCount({ ownerUserId: "user-1", supabase: db as never });
  assert.equal(count.count, null);
});
