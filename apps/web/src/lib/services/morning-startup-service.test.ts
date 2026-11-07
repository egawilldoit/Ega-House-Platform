import assert from "node:assert/strict";
import test from "node:test";

import type { OperatorSnapshot } from "@ega/application";
import { getLocalDayWindow } from "@ega/domain";
import { DEFAULT_USER_PREFERENCES } from "@ega/domain/preferences";

import {
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
  error?: unknown;
  calls?: QueryCall[];
}) {
  const calls = options.calls ?? [];
  const builder: Record<string, unknown> = {};

  for (const method of ["eq", "gte", "lt", "order", "limit", "in"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }

  builder.then = (
    onFulfilled?: (value: { data: unknown; error: unknown }) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) =>
    Promise.resolve({
      data: options.error ? null : options.rows ?? [],
      error: options.error ?? null,
    }).then(onFulfilled, onRejected);

  return {
    calls,
    supabase: {
      from(table: string) {
        calls.push({ method: "from", args: [table] });
        return {
          select(columns: string) {
            calls.push({ method: "select", args: [columns] });
            return builder;
          },
        };
      },
    } as never,
  };
}

function call(calls: QueryCall[], method: string): QueryCall | undefined {
  return calls.find((entry) => entry.method === method);
}

test("yesterday read uses the owner timezone's half-open [dayStart, dayEnd) window", async () => {
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
  });

  const model = await getMorningStartupData(snapshot(), {
    supabase,
    preferences: DEFAULT_USER_PREFERENCES,
  });

  const expectedWindow = getLocalDayWindow("Africa/Lagos", "2026-11-06");

  assert.deepEqual(call(calls, "from")?.args, ["tasks"]);
  assert.deepEqual(call(calls, "eq")?.args, ["status", "done"]);
  assert.deepEqual(call(calls, "gte")?.args, ["completed_at", expectedWindow.startUtcIso]);
  assert.deepEqual(call(calls, "lt")?.args, ["completed_at", expectedWindow.endUtcIso]);
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
    error: { message: "boom" },
  });

  const model = await getMorningStartupData(snapshot(), {
    supabase,
    preferences: DEFAULT_USER_PREFERENCES,
  });

  assert.equal(model.yesterday.errorMessage, MORNING_STARTUP_YESTERDAY_ERROR_MESSAGE);
  assert.equal(model.yesterday.completedCount, 0);
  assert.equal(model.skipped, false);
});

test("startMorningOutcomes dedupes ids and plans each task in submitted order", async () => {
  const { supabase, calls } = createSupabaseMock({
    rows: [
      {
        id: "a",
        status: "todo",
        archived_at: null,
        project_id: "project-a",
        projects: { name: "Alpha", slug: "alpha" },
      },
      {
        id: "b",
        status: "in_progress",
        archived_at: null,
        project_id: "project-a",
        projects: { name: "Alpha", slug: "alpha" },
      },
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
      {
        id: "a",
        status: "todo",
        archived_at: null,
        project_id: "project-a",
        projects: { name: "Alpha", slug: "alpha" },
      },
      {
        id: "b",
        status: "todo",
        archived_at: null,
        project_id: "project-b",
        projects: { name: "Beta", slug: "beta" },
      },
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

test("a missing owned row is rejected instead of silently planning a subset", async () => {
  const { supabase } = createSupabaseMock({
    rows: [
      {
        id: "a",
        status: "todo",
        archived_at: null,
        project_id: "project-a",
        projects: { name: "Alpha", slug: "alpha" },
      },
    ],
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
    rows: [
      {
        id: "a",
        status: "todo",
        archived_at: null,
        project_id: "project-a",
        projects: { name: "Alpha", slug: "alpha" },
      },
      {
        id: "b",
        status: "todo",
        archived_at: null,
        project_id: "project-a",
        projects: { name: "Alpha", slug: "alpha" },
      },
    ],
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

test("a query failure returns an actionable error and makes no plan write", async () => {
  const { supabase } = createSupabaseMock({
    rows: null,
    error: { message: "rls denied" },
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
