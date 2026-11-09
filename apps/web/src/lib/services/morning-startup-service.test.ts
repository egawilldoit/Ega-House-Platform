import assert from "node:assert/strict";
import test from "node:test";

import type { OperatorSnapshot } from "@ega/application";
import { getLocalDayWindow } from "@ega/domain";
import { DEFAULT_USER_PREFERENCES } from "@ega/domain/preferences";

import {
  MORNING_OUTCOME_ARCHIVED_GOAL_MESSAGE,
  MORNING_OUTCOME_ARCHIVED_PROJECT_MESSAGE,
  MORNING_OUTCOME_MIXED_PROJECT_MESSAGE,
  MORNING_OUTCOME_UNAVAILABLE_MESSAGE,
  MORNING_STARTUP_YESTERDAY_ERROR_MESSAGE,
} from "@/lib/morning-startup";

import {
  getMorningStartupData,
  startMorningOutcomes,
  type MorningStartupPlanTask,
} from "./morning-startup-service";

type QueryCall = { method: string; args: unknown[] };

const YESTERDAY_ROW_COLUMNS =
  "id, title, status, completed_at, project_id, projects(name, slug)";

function snapshot(overrides: Partial<OperatorSnapshot> = {}): OperatorSnapshot {
  return {
    date: "2026-11-07",
    timezone: "Africa/Lagos",
    dayWindow: {
      startUtcIso: "2026-11-06T23:00:00.000Z",
      endUtcIso: "2026-11-07T23:00:00.000Z",
    },
    timeContextId: "2026-11-07::Africa/Lagos::2026-11-06T23:00:00.000Z",
    sections: { planned: [], inProgress: [], blocked: [], completed: [] },
    focus: { startHere: null, queue: [] },
    schedule: { blocks: [], flexible: [] },
    plannedToday: [],
    suggestions: { pinned: [], inProgress: [] },
    summary: {
      plannedCount: 0,
      inProgressCount: 0,
      blockedCount: 0,
      completedCount: 0,
      selectedCount: 0,
      clearableCompletedCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      totalEstimateMinutes: 0,
      trackedTodaySeconds: 0,
      trackedTodayLabel: "0m",
    },
    activeTimer: null,
    signals: { health: null, friction: null, inbox: null, weeklyObjective: null },
    ...overrides,
  };
}

function createSupabaseMock(options: {
  rows?: unknown[] | null;
  count?: number | null;
  rowError?: unknown;
  calls?: QueryCall[];
}) {
  const calls = options.calls ?? [];

  function createBuilder(result: { data: unknown; error: unknown; count: number | null }) {
    const builder: Record<string, unknown> = {};

    for (const method of ["eq", "gte", "lt", "order", "limit", "in"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }

    builder.then = (
      onFulfilled?: (value: { data: unknown; error: unknown; count: number | null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected);

    return builder;
  }

  return {
    calls,
    supabase: {
      from(table: string) {
        calls.push({ method: "from", args: [table] });
        return {
          select(columns: string, selectOptions?: { count?: string; head?: boolean }) {
            calls.push({
              method: "select",
              args: selectOptions === undefined ? [columns] : [columns, selectOptions],
            });
            return createBuilder({
              data: options.rowError ? null : options.rows ?? [],
              error: options.rowError ?? null,
              count: options.count ?? null,
            });
          },
        };
      },
    } as never,
  };
}

function allCalls(calls: QueryCall[], method: string): QueryCall[] {
  return calls.filter((entry) => entry.method === method);
}

function call(calls: QueryCall[], method: string): QueryCall | undefined {
  return calls.find((entry) => entry.method === method);
}

function ownedRow(
  overrides: {
    id: string;
    status?: string;
    projectId?: string;
    projects?: unknown;
    goalId?: string | null;
    goals?: unknown;
  },
) {
  const project =
    "projects" in overrides
      ? overrides.projects
      : { name: "Alpha", slug: "alpha", archived_at: null };
  return {
    id: overrides.id,
    status: overrides.status ?? "todo",
    archived_at: null,
    project_id: overrides.projectId ?? "project-a",
    projects: project,
    goal_id: overrides.goalId ?? null,
    goals: overrides.goals ?? null,
  };
}

test("yesterday read uses all completed aliases and the owner timezone's half-open window", async () => {
  const { supabase, calls } = createSupabaseMock({
    rows: [
      {
        id: "y1",
        title: "Ship review",
        status: "done",
        completed_at: "2026-11-06T18:00:00.000Z",
        project_id: "project-a",
        projects: { name: "Alpha", slug: "alpha" },
      },
    ],
    count: 1,
  });

  const model = await getMorningStartupData(snapshot(), {
    supabase,
    preferences: DEFAULT_USER_PREFERENCES,
  });

  const expectedWindow = getLocalDayWindow("Africa/Lagos", "2026-11-06");
  const selects = allCalls(calls, "select");

  assert.deepEqual(call(calls, "from")?.args, ["tasks"]);
  assert.deepEqual(selects[0]?.args, [YESTERDAY_ROW_COLUMNS, { count: "exact" }]);
  assert.equal(selects.length, 1);
  assert.equal(allCalls(calls, "in").length, 1);
  for (const entry of allCalls(calls, "in")) {
    assert.deepEqual(entry.args, ["status", ["done", "complete", "completed"]]);
  }
  for (const entry of allCalls(calls, "gte")) {
    assert.deepEqual(entry.args, ["completed_at", expectedWindow.startUtcIso]);
  }
  for (const entry of allCalls(calls, "lt")) {
    assert.deepEqual(entry.args, ["completed_at", expectedWindow.endUtcIso]);
  }
  assert.equal(allCalls(calls, "gte").length, 1);
  assert.equal(allCalls(calls, "lt").length, 1);
  assert.deepEqual(call(calls, "order")?.args, ["completed_at", { ascending: false }]);
  assert.deepEqual(call(calls, "limit")?.args, [20]);
  assert.equal(model.yesterday.completedCount, 1);
  assert.deepEqual(model.yesterday.tasks, [
    {
      id: "y1",
      title: "Ship review",
      projectName: "Alpha",
      projectSlug: "alpha",
      completedAt: "2026-11-06T18:00:00.000Z",
    },
  ]);
});

test("a failed yesterday read returns a non-fatal inline error instead of throwing", async () => {
  const { supabase } = createSupabaseMock({
    rows: null,
    rowError: { message: "boom" },
    count: 0,
  });

  const model = await getMorningStartupData(snapshot(), {
    supabase,
    preferences: DEFAULT_USER_PREFERENCES,
  });

  assert.equal(model.yesterday.errorMessage, MORNING_STARTUP_YESTERDAY_ERROR_MESSAGE);
  assert.equal(model.yesterday.completedCount, 0);
  assert.equal(model.skipped, false);
});

test("the exact yesterday count is independent of the capped row list", async () => {
  const manyRows = Array.from({ length: 20 }, (_, index) => ({
    id: `y${index}`,
    title: `Yesterday ${index}`,
    status: "done",
    completed_at: "2026-11-06T18:00:00.000Z",
    project_id: "project-a",
    projects: { name: "Alpha", slug: "alpha" },
  }));
  const { supabase } = createSupabaseMock({ rows: manyRows, count: 21 });

  const model = await getMorningStartupData(snapshot(), {
    supabase,
    preferences: DEFAULT_USER_PREFERENCES,
  });

  assert.equal(model.yesterday.completedCount, 21);
  assert.equal(model.yesterday.tasks.length, 5);
});

test("a null exact count falls back to the bounded row count", async () => {
  const threeRows = Array.from({ length: 3 }, (_, index) => ({
    id: `y${index}`,
    title: `Yesterday ${index}`,
    status: "done",
    completed_at: "2026-11-06T18:00:00.000Z",
    project_id: "project-a",
    projects: { name: "Alpha", slug: "alpha" },
  }));
  const { supabase } = createSupabaseMock({
    rows: threeRows,
    count: null,
  });

  const model = await getMorningStartupData(snapshot(), {
    supabase,
    preferences: DEFAULT_USER_PREFERENCES,
  });

  assert.equal(model.yesterday.completedCount, 3);
  assert.equal(model.yesterday.tasks.length, 3);
});

test("preferences failure is carried through the model as a degraded note", async () => {
  const { supabase } = createSupabaseMock({ rows: [], count: 0 });

  const model = await getMorningStartupData(snapshot(), {
    supabase,
    preferences: DEFAULT_USER_PREFERENCES,
    preferencesErrorMessage: "Unable to load preferences right now.",
  });

  assert.equal(model.preferencesErrorMessage, "Unable to load preferences right now.");
});

test("startMorningOutcomes dedupes ids and plans each task in submitted order", async () => {
  const { supabase, calls } = createSupabaseMock({
    rows: [
      ownedRow({ id: "a", projects: { name: "Alpha", slug: "alpha", archived_at: null } }),
      ownedRow({
        id: "b",
        status: "in_progress",
        projects: { name: "Alpha", slug: "alpha", archived_at: null },
      }),
    ],
  });

  const planned: Array<{ taskId: string; localDate?: string }> = [];
  const planTask: MorningStartupPlanTask = async (taskId, options) => {
    planned.push({ taskId, localDate: options.localDate });
    return { errorMessage: null };
  };

  const result = await startMorningOutcomes({
    taskIds: [" b ", "a", "b", "a"],
    supabase,
    planTask,
    localDate: "2026-11-07",
    now: new Date("2026-11-07T06:00:00.000Z"),
  });

  assert.deepEqual(call(calls, "in")?.args, ["id", ["b", "a"]]);
  assert.match(
    String(call(calls, "select")?.args[0] ?? ""),
    /goals\(archived_at\)/,
  );
  assert.deepEqual(planned, [
    { taskId: "b", localDate: "2026-11-07" },
    { taskId: "a", localDate: "2026-11-07" },
  ]);
  assert.deepEqual(result, { errorMessage: null, appliedCount: 2 });
});

test("invalid input makes no query and no write", async () => {
  let queried = false;
  let planned = false;

  const supabase = {
    from() {
      queried = true;
      throw new Error("must not query");
    },
  } as never;

  const planTask: MorningStartupPlanTask = async () => {
    planned = true;
    return { errorMessage: null };
  };

  const result = await startMorningOutcomes({ taskIds: [], supabase, planTask });

  assert.equal(result.errorMessage, "Choose at least one outcome task to start your day.");
  assert.equal(result.appliedCount, 0);
  assert.equal(queried, false);
  assert.equal(planned, false);
});

test("mixed-project rows are rejected before any plan write", async () => {
  const { supabase } = createSupabaseMock({
    rows: [
      ownedRow({ id: "a", projects: { name: "Alpha", slug: "alpha", archived_at: null } }),
      ownedRow({
        id: "b",
        projectId: "project-b",
        projects: { name: "Beta", slug: "beta", archived_at: null },
      }),
    ],
  });

  let planned = false;
  const planTask: MorningStartupPlanTask = async () => {
    planned = true;
    return { errorMessage: null };
  };

  const result = await startMorningOutcomes({ taskIds: ["a", "b"], supabase, planTask });

  assert.equal(result.errorMessage, MORNING_OUTCOME_MIXED_PROJECT_MESSAGE);
  assert.equal(result.appliedCount, 0);
  assert.equal(planned, false);
});

test("archived project and goal ancestry are rejected before any plan write", async () => {
  for (const scenario of [
    {
      rows: [
        ownedRow({
          id: "archived-project",
          projects: {
            name: "Alpha",
            slug: "alpha",
            archived_at: "2026-11-01T00:00:00.000Z",
          },
        }),
      ],
      expected: MORNING_OUTCOME_ARCHIVED_PROJECT_MESSAGE,
    },
    {
      rows: [
        ownedRow({
          id: "archived-goal",
          projects: { name: "Alpha", slug: "alpha", archived_at: null },
          goalId: "goal-1",
          goals: { archived_at: "2026-11-01T00:00:00.000Z" },
        }),
      ],
      expected: MORNING_OUTCOME_ARCHIVED_GOAL_MESSAGE,
    },
  ]) {
    const { supabase } = createSupabaseMock({ rows: scenario.rows });
    let planned = false;
    const planTask: MorningStartupPlanTask = async () => {
      planned = true;
      return { errorMessage: null };
    };

    const result = await startMorningOutcomes({
      taskIds: [String((scenario.rows[0] as { id: string }).id)],
      supabase,
      planTask,
    });

    assert.equal(result.errorMessage, scenario.expected);
    assert.equal(result.appliedCount, 0);
    assert.equal(planned, false);
  }
});

test("missing project or goal ancestry fails closed before any plan write", async () => {
  for (const scenario of [
    {
      rows: [
        ownedRow({
          id: "missing-project",
          projects: null,
        }),
      ],
      expected: MORNING_OUTCOME_UNAVAILABLE_MESSAGE,
    },
    {
      rows: [
        ownedRow({
          id: "missing-goal",
          goalId: "goal-1",
          goals: null,
        }),
      ],
      expected: MORNING_OUTCOME_UNAVAILABLE_MESSAGE,
    },
  ]) {
    const { supabase } = createSupabaseMock({ rows: scenario.rows });
    let planned = false;
    const planTask: MorningStartupPlanTask = async () => {
      planned = true;
      return { errorMessage: null };
    };

    const result = await startMorningOutcomes({
      taskIds: [String((scenario.rows[0] as { id: string }).id)],
      supabase,
      planTask,
    });

    assert.equal(result.errorMessage, scenario.expected);
    assert.equal(result.appliedCount, 0);
    assert.equal(planned, false);
  }
});

test("array-shaped ancestry relations are still readable", async () => {
  const { supabase } = createSupabaseMock({
    rows: [
      ownedRow({
        id: "array-relations",
        projects: [{ name: "Alpha", slug: "alpha", archived_at: null }],
        goalId: "goal-1",
        goals: [{ archived_at: null }],
      }),
    ],
  });

  const planned: string[] = [];
  const planTask: MorningStartupPlanTask = async (taskId) => {
    planned.push(taskId);
    return { errorMessage: null };
  };

  const result = await startMorningOutcomes({
    taskIds: ["array-relations"],
    supabase,
    planTask,
  });

  assert.deepEqual(result, { errorMessage: null, appliedCount: 1 });
  assert.deepEqual(planned, ["array-relations"]);
});

test("a null goal_id is legitimate and does not require a goal relation", async () => {
  const { supabase } = createSupabaseMock({
    rows: [ownedRow({ id: "no-goal", goalId: null, goals: null })],
  });

  const planTask: MorningStartupPlanTask = async () => ({ errorMessage: null });

  const result = await startMorningOutcomes({
    taskIds: ["no-goal"],
    supabase,
    planTask,
  });

  assert.deepEqual(result, { errorMessage: null, appliedCount: 1 });
});

test("a missing owned row is rejected instead of silently planning a subset", async () => {
  const { supabase } = createSupabaseMock({
    rows: [ownedRow({ id: "a" })],
  });

  let planned = false;
  const planTask: MorningStartupPlanTask = async () => {
    planned = true;
    return { errorMessage: null };
  };

  const result = await startMorningOutcomes({ taskIds: ["a", "b"], supabase, planTask });

  assert.equal(result.errorMessage, MORNING_OUTCOME_UNAVAILABLE_MESSAGE);
  assert.equal(result.appliedCount, 0);
  assert.equal(planned, false);
});

test("a mid-loop failure reports the applied count and never a success result", async () => {
  const { supabase } = createSupabaseMock({
    rows: [ownedRow({ id: "a" }), ownedRow({ id: "b" })],
  });

  const planTask: MorningStartupPlanTask = async (taskId) => {
    if (taskId === "b") {
      return { errorMessage: "Unable to update task right now." };
    }
    return { errorMessage: null };
  };

  const result = await startMorningOutcomes({ taskIds: ["a", "b"], supabase, planTask });

  assert.equal(result.appliedCount, 1);
  assert.ok(result.errorMessage);
  assert.match(result.errorMessage ?? "", /saved 1 of 2 outcomes/);
  assert.match(result.errorMessage ?? "", /Unable to update task right now\./);
});

test("a thrown planTask after a partial write reports the real applied count and no success", async () => {
  const { supabase } = createSupabaseMock({
    rows: [ownedRow({ id: "a" }), ownedRow({ id: "b" })],
  });

  const applied: string[] = [];
  const planTask: MorningStartupPlanTask = async (taskId) => {
    if (taskId === "b") {
      throw new Error("transport dropped");
    }
    applied.push(taskId);
    return { errorMessage: null };
  };

  const result = await startMorningOutcomes({ taskIds: ["a", "b"], supabase, planTask });

  assert.deepEqual(applied, ["a"]);
  assert.equal(result.appliedCount, 1);
  assert.ok(result.errorMessage);
  assert.match(result.errorMessage ?? "", /saved 1 of 2 outcomes/);
  assert.match(result.errorMessage ?? "", /Unable to update task right now\./);
});

test("a query failure returns an actionable error and makes no plan write", async () => {
  const { supabase } = createSupabaseMock({
    rows: null,
    rowError: { message: "rls denied" },
  });

  let planned = false;
  const planTask: MorningStartupPlanTask = async () => {
    planned = true;
    return { errorMessage: null };
  };

  const result = await startMorningOutcomes({ taskIds: ["a"], supabase, planTask });

  assert.equal(result.errorMessage, "Unable to verify the selected outcome tasks right now.");
  assert.equal(result.appliedCount, 0);
  assert.equal(planned, false);
});
