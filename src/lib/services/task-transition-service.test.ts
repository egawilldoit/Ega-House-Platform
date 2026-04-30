import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveTaskSafely,
  blockTask,
  markTaskDone,
  markTaskTodo,
  planTaskForToday,
  removeTaskFromToday,
  resumeTask,
} from "./task-transition-service";

type MockTask = {
  id: string;
  status: string;
  completed_at: string | null;
  blocked_reason?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  focus_rank?: number | null;
  planned_for_date?: string | null;
  updated_at?: string | null;
};

type MockSession = {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds?: number | null;
  updated_at?: string | null;
};

function createTaskTransitionSupabaseMock(options?: {
  tasks?: MockTask[];
  sessions?: MockSession[];
}) {
  const tasks = [
    ...(options?.tasks ?? [
      {
        id: "task-1",
        status: "todo",
        completed_at: null,
      },
    ]),
  ];
  const sessions = [...(options?.sessions ?? [])];
  const taskUpdateCalls: Array<{ payload: Record<string, unknown>; taskId: string }> = [];
  const sessionUpdateCalls: Array<{ payload: Record<string, unknown>; sessionId: string }> = [];

  const supabase = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    from(table: string) {
      if (table === "tasks") {
        return {
          update(payload: Record<string, unknown>) {
            const state = { taskId: "" };
            return {
              eq(column: string, value: string) {
                assert.equal(column, "id");
                state.taskId = value;
                return this;
              },
              select(columns: string) {
                assert.equal(columns, "id");
                return {
                  maybeSingle: async () => {
                    taskUpdateCalls.push({ payload, taskId: state.taskId });
                    const taskIndex = tasks.findIndex((task) => task.id === state.taskId);

                    if (taskIndex < 0) {
                      return { data: null, error: null };
                    }

                    tasks[taskIndex] = {
                      ...tasks[taskIndex],
                      ...payload,
                    };

                    return { data: { id: state.taskId }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "task_sessions") {
        return {
          select(columns: string) {
            assert.ok(["id", "id, started_at"].includes(columns));

            const state = {
              taskId: "",
              openOnly: false,
            };

            return {
              eq(column: string, value: string) {
                assert.equal(column, "task_id");
                state.taskId = value;
                return this;
              },
              is(column: string, value: null) {
                assert.equal(column, "ended_at");
                assert.equal(value, null);
                state.openOnly = true;
                return this;
              },
              order(column: string) {
                assert.equal(column, "started_at");
                return Promise.resolve({
                  data: sessions
                    .filter((session) => session.task_id === state.taskId)
                    .filter((session) => (state.openOnly ? session.ended_at === null : true))
                    .map((session) => ({
                      id: session.id,
                      started_at: session.started_at,
                    })),
                  error: null,
                });
              },
              limit(count: number) {
                assert.equal(count, 1);
                return Promise.resolve({
                  data: sessions
                    .filter((session) => session.task_id === state.taskId)
                    .filter((session) => (state.openOnly ? session.ended_at === null : true))
                    .slice(0, count)
                    .map((session) => ({ id: session.id })),
                  error: null,
                });
              },
            };
          },
          update(payload: Record<string, unknown>) {
            const state = {
              sessionId: "",
              openOnly: false,
            };

            return {
              eq(column: string, value: string) {
                assert.equal(column, "id");
                state.sessionId = value;
                return this;
              },
              is(column: string, value: null) {
                assert.equal(column, "ended_at");
                assert.equal(value, null);
                state.openOnly = true;
                return this;
              },
              select(columns: string) {
                assert.equal(columns, "id");
                return {
                  maybeSingle: async () => {
                    const sessionIndex = sessions.findIndex(
                      (session) => session.id === state.sessionId,
                    );

                    if (sessionIndex < 0) {
                      return { data: null, error: null };
                    }

                    if (state.openOnly && sessions[sessionIndex]?.ended_at !== null) {
                      return { data: null, error: null };
                    }

                    sessionUpdateCalls.push({ payload, sessionId: state.sessionId });
                    sessions[sessionIndex] = {
                      ...sessions[sessionIndex],
                      ended_at: String(payload.ended_at),
                      duration_seconds: Number(payload.duration_seconds),
                      updated_at: String(payload.updated_at),
                    };

                    return { data: { id: state.sessionId }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return {
    supabase: supabase as never,
    tasks,
    sessions,
    taskUpdateCalls,
    sessionUpdateCalls,
  };
}

test("markTaskDone marks a task done and sets completed_at", async () => {
  const mock = createTaskTransitionSupabaseMock();

  const result = await markTaskDone("task-1", {
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:00:00.000Z",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(mock.tasks[0]?.status, "done");
  assert.equal(mock.tasks[0]?.completed_at, "2026-04-21T10:00:00.000Z");
  assert.deepEqual(mock.taskUpdateCalls[0]?.payload, {
    status: "done",
    completed_at: "2026-04-21T10:00:00.000Z",
    updated_at: "2026-04-21T10:00:00.000Z",
  });
});

test("markTaskDone stops active timer sessions for that task", async () => {
  const mock = createTaskTransitionSupabaseMock({
    sessions: [
      {
        id: "session-target",
        task_id: "task-1",
        started_at: "2026-04-21T09:45:00.000Z",
        ended_at: null,
      },
      {
        id: "session-other",
        task_id: "task-2",
        started_at: "2026-04-21T09:50:00.000Z",
        ended_at: null,
      },
    ],
  });

  const result = await markTaskDone("task-1", {
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:00:00.000Z",
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(
    mock.sessionUpdateCalls.map((call) => call.sessionId),
    ["session-target"],
  );
  assert.deepEqual(mock.sessionUpdateCalls[0]?.payload, {
    ended_at: "2026-04-21T10:00:00.000Z",
    duration_seconds: 900,
    updated_at: "2026-04-21T10:00:00.000Z",
  });
  assert.equal(mock.sessions.find((session) => session.id === "session-other")?.ended_at, null);
  assert.equal(mock.tasks[0]?.status, "done");
});

test("blockTask requires a non-empty blocked reason", async () => {
  const mock = createTaskTransitionSupabaseMock();

  const invalidResult = await blockTask("task-1", "   ", {
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:00:00.000Z",
  });

  assert.equal(invalidResult.errorMessage, "Blocked reason is required.");
  assert.equal(mock.taskUpdateCalls.length, 0);

  const validResult = await blockTask("task-1", " waiting on vendor API ", {
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:05:00.000Z",
  });

  assert.equal(validResult.errorMessage, null);
  assert.equal(mock.tasks[0]?.status, "blocked");
  assert.equal(mock.tasks[0]?.blocked_reason, "waiting on vendor API");
  assert.deepEqual(mock.taskUpdateCalls[0]?.payload, {
    status: "blocked",
    blocked_reason: "waiting on vendor API",
    updated_at: "2026-04-21T10:05:00.000Z",
  });
});

test("resumeTask clears blocked_reason", async () => {
  const mock = createTaskTransitionSupabaseMock({
    tasks: [
      {
        id: "task-1",
        status: "blocked",
        blocked_reason: "waiting on vendor API",
        completed_at: null,
      },
    ],
  });

  const result = await resumeTask("task-1", {
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:10:00.000Z",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(mock.tasks[0]?.status, "in_progress");
  assert.equal(mock.tasks[0]?.blocked_reason, null);
  assert.deepEqual(mock.taskUpdateCalls[0]?.payload, {
    status: "in_progress",
    blocked_reason: null,
    updated_at: "2026-04-21T10:10:00.000Z",
  });
});

test("markTaskTodo clears completed_at when moving away from done", async () => {
  const mock = createTaskTransitionSupabaseMock({
    tasks: [
      {
        id: "task-1",
        status: "done",
        completed_at: "2026-04-20T12:00:00.000Z",
      },
    ],
  });

  const result = await markTaskTodo("task-1", {
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:15:00.000Z",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(mock.tasks[0]?.status, "todo");
  assert.equal(mock.tasks[0]?.completed_at, null);
  assert.deepEqual(mock.taskUpdateCalls[0]?.payload, {
    status: "todo",
    completed_at: null,
    updated_at: "2026-04-21T10:15:00.000Z",
  });
});

test("archiveTaskSafely refuses to archive a task with an active timer", async () => {
  const mock = createTaskTransitionSupabaseMock({
    sessions: [
      {
        id: "session-open",
        task_id: "task-1",
        started_at: "2026-04-21T09:45:00.000Z",
        ended_at: null,
      },
    ],
  });

  const result = await archiveTaskSafely("task-1", {
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:20:00.000Z",
  });

  assert.equal(result.errorMessage, "Stop the active timer before archiving this task.");
  assert.equal(mock.tasks[0]?.archived_at ?? null, null);
  assert.equal(mock.taskUpdateCalls.length, 0);
});

test("archiveTaskSafely archives safely and clears focus_rank", async () => {
  const mock = createTaskTransitionSupabaseMock({
    tasks: [
      {
        id: "task-1",
        status: "in_progress",
        completed_at: null,
        archived_at: null,
        archived_by: null,
        focus_rank: 2,
      },
    ],
  });

  const result = await archiveTaskSafely("task-1", {
    supabase: mock.supabase,
    nowIso: "2026-04-21T10:25:00.000Z",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(mock.tasks[0]?.status, "in_progress");
  assert.equal(mock.tasks[0]?.archived_at, "2026-04-21T10:25:00.000Z");
  assert.equal(mock.tasks[0]?.archived_by, "user-1");
  assert.equal(mock.tasks[0]?.focus_rank, null);
  assert.deepEqual(mock.taskUpdateCalls[0]?.payload, {
    archived_at: "2026-04-21T10:25:00.000Z",
    archived_by: "user-1",
    focus_rank: null,
    updated_at: "2026-04-21T10:25:00.000Z",
  });
});

test("planTaskForToday sets planned_for_date to local today", async () => {
  const mock = createTaskTransitionSupabaseMock();
  const localToday = new Date(2026, 3, 21, 12, 0, 0, 0);
  const localTodayIso = localToday.toISOString();

  const result = await planTaskForToday("task-1", {
    supabase: mock.supabase,
    now: localToday,
    nowIso: localTodayIso,
  });

  assert.equal(result.errorMessage, null);
  assert.equal(mock.tasks[0]?.planned_for_date, "2026-04-21");
  assert.deepEqual(mock.taskUpdateCalls[0]?.payload, {
    planned_for_date: "2026-04-21",
    updated_at: localTodayIso,
  });
});

test("removeTaskFromToday clears planned_for_date", async () => {
  const mock = createTaskTransitionSupabaseMock({
    tasks: [
      {
        id: "task-1",
        status: "todo",
        completed_at: null,
        planned_for_date: "2026-04-21",
      },
    ],
  });

  const result = await removeTaskFromToday("task-1", {
    supabase: mock.supabase,
    nowIso: "2026-04-21T23:35:00.000Z",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(mock.tasks[0]?.planned_for_date, null);
  assert.equal(mock.tasks[0]?.status, "todo");
  assert.deepEqual(mock.taskUpdateCalls[0]?.payload, {
    planned_for_date: null,
    updated_at: "2026-04-21T23:35:00.000Z",
  });
});
