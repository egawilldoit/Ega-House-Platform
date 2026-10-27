import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWorkspaceSearchQuery,
  searchWorkspace,
} from "./workspace-search-service";

type TableCall = { table: string; select: string };

function createSearchSupabaseMock(overrides?: {
  tasks?: unknown[];
  projects?: unknown[];
  goals?: unknown[];
  ideas?: unknown[];
  errorTable?: string;
}) {
  const calls: TableCall[] = [];
  const queryLog: Array<{ table: string; pattern: string | null; limit: number | null }> = [];

  const buildBuilder = (table: string) => {
    const state = { pattern: null as string | null, limit: null as number | null };

    const failIfNeeded = () => {
      if (overrides?.errorTable === table) {
        return { error: { message: `boom ${table}` }, data: null };
      }
      return null;
    };

    return {
      select(columns: string) {
        calls.push({ table, select: columns });

        const builder = {
          ilike(column: string, pattern: string) {
            assert.equal(column, table === "projects" ? "name" : "title");
            state.pattern = pattern;
            queryLog.push({ table, pattern, limit: null });
            return builder;
          },
          order(column: string, options?: { ascending?: boolean }) {
            assert.ok(column.length > 0);
            assert.equal(typeof options?.ascending, "boolean");
            return builder;
          },
          limit(count: number) {
            state.limit = count;
            queryLog[queryLog.length - 1].limit = count;
            return builder;
          },
          then(onFulfilled?: (value: unknown) => unknown) {
            const failure = failIfNeeded();
            const rows =
              failure?.data ??
              (table === "tasks"
                ? overrides?.tasks ?? []
                : table === "projects"
                  ? overrides?.projects ?? []
                  : table === "goals"
                    ? overrides?.goals ?? []
                    : overrides?.ideas ?? []);
            return Promise.resolve(onFulfilled?.({ data: rows, error: failure?.error ?? null }));
          },
        };

        return builder;
      },
    };
  };

  return {
    calls,
    queryLog,
    client: {
      from(table: string) {
        assert.ok(["tasks", "projects", "goals", "idea_notes"].includes(table));
        return buildBuilder(table);
      },
    },
  };
}

test("normalizes search queries by trimming and capping length", () => {
  assert.equal(normalizeWorkspaceSearchQuery("  landing page  "), "landing page");
  assert.equal(normalizeWorkspaceSearchQuery(undefined), "");
  assert.equal(normalizeWorkspaceSearchQuery("x".repeat(300)).length, 120);
});

test("returns empty results for queries shorter than the minimum", async () => {
  const mock = createSearchSupabaseMock();

  const results = await searchWorkspace("a", { supabase: mock.client as never });

  assert.deepEqual(results, {
    query: "a",
    scope: "all",
    tasks: [],
    projects: [],
    goals: [],
    ideas: [],
  });
  assert.equal(mock.calls.length, 0);
});

test("searches tasks, projects, and goals with escaped ilike patterns and limits", async () => {
  const mock = createSearchSupabaseMock({
    tasks: [
      { id: "t1", title: "Ship landing page", status: "todo", projects: { name: "Web" } },
      { id: "t2", title: "Review landing page copy", status: "doing", projects: null },
    ],
    projects: [{ id: "p1", name: "Landing", slug: "landing" }],
    goals: [{ id: "g1", title: "Launch landing page" }],
    ideas: [{ id: "i1", title: "Landing page idea", status: "inbox" }],
  });

  const results = await searchWorkspace("landing_page", { supabase: mock.client as never });

  assert.equal(results.query, "landing_page");
  assert.deepEqual(results.tasks, [
    { id: "t1", title: "Ship landing page", status: "todo", projectName: "Web" },
    { id: "t2", title: "Review landing page copy", status: "doing", projectName: null },
  ]);
  assert.deepEqual(results.projects, [{ id: "p1", name: "Landing", slug: "landing" }]);
  assert.deepEqual(results.goals, [{ id: "g1", title: "Launch landing page" }]);
  assert.deepEqual(results.ideas, [{ id: "i1", title: "Landing page idea", status: "inbox" }]);

  const escapedPattern = "%landing\\_page%";
  for (const entry of mock.queryLog) {
    assert.equal(entry.pattern, escapedPattern);
    assert.ok(entry.limit !== null);
  }

  const taskCall = mock.calls.find((call) => call.table === "tasks");
  assert.match(taskCall?.select ?? "", /id, title, status, projects\(name\)/);
});

test("scoped search queries only the requested table and reports its scope", async () => {
  const mock = createSearchSupabaseMock({
    tasks: [{ id: "t1", title: "Ship landing page", status: "todo", projects: null }],
    ideas: [{ id: "i1", title: "Landing idea", status: "inbox" }],
  });

  const results = await searchWorkspace("landing", {
    supabase: mock.client as never,
    scope: "ideas",
  });

  assert.equal(results.scope, "ideas");
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].table, "idea_notes");
  assert.deepEqual(results.tasks, []);
  assert.deepEqual(results.ideas, [{ id: "i1", title: "Landing idea", status: "inbox" }]);
});

test("an unknown scope falls back to all instead of a partial search", async () => {
  const mock = createSearchSupabaseMock();
  const results = await searchWorkspace("landing", {
    supabase: mock.client as never,
    scope: "comments",
  });

  assert.equal(results.scope, "all");
  assert.equal(mock.calls.length, 4);
});

test("propagates a searchable error when a table query fails", async () => {
  const mock = createSearchSupabaseMock({ errorTable: "goals" });

  await assert.rejects(
    () => searchWorkspace("launch", { supabase: mock.client as never }),
    /Failed to search goals: boom goals/,
  );
});
