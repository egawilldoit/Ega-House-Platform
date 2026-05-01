import assert from "node:assert/strict";
import test from "node:test";

import {
  createTasks,
  createTaskWithOptionalWorkedTime,
  getTasksWorkspaceData,
  normalizeTaskBlockedReasonInput,
  updateTaskInline,
  validateTaskInlineUpdateInput,
} from "./task-service";

test("normalizes blocked reason input without overvalidating free text", () => {
  assert.equal(normalizeTaskBlockedReasonInput(" waiting on vendor API "), "waiting on vendor API");
  assert.equal(normalizeTaskBlockedReasonInput(""), null);
  assert.equal(normalizeTaskBlockedReasonInput(null), null);
});

test("requires blocked reason when inline status is blocked", () => {
  const result = validateTaskInlineUpdateInput({
    taskId: "task-1",
    status: "blocked",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    blockedReason: "",
  });

  assert.equal(result.errorMessage, "Blocked reason is required when status is Blocked.");
});

test("allows inline update without blocked reason when status is not blocked", () => {
  const result = validateTaskInlineUpdateInput({
    taskId: "task-1",
    status: "todo",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    blockedReason: "",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.blockedReason, null);
});

test("clears blocked reason when status is not blocked", () => {
  const result = validateTaskInlineUpdateInput({
    taskId: "task-1",
    status: "in_progress",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    blockedReason: "waiting on infra fix",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.blockedReason, null);
});

type MockSession = {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds?: number | null;
  updated_at?: string | null;
};

type MockTask = {
  id: string;
  status: string;
  completed_at: string | null;
  archived_at: string | null;
};

function createTaskInlineSupabaseMock(options?: {
  tasks?: MockTask[];
  sessions?: MockSession[];
  failSessionLookup?: boolean;
  failSessionUpdateId?: string;
  failTaskUpdate?: boolean;
  taskUpdateReturnsNoRow?: boolean;
}) {
  const tasks = [
    ...(options?.tasks ?? [
      {
        id: "task-1",
        status: "todo",
        completed_at: null,
        archived_at: null,
      },
    ]),
  ];
  const sessions = [...(options?.sessions ?? [])];
  const taskUpdateCalls: Array<{ payload: Record<string, unknown>; taskId: string }> = [];
  const sessionUpdateCalls: Array<{ payload: Record<string, unknown>; sessionId: string }> = [];
  let sessionLookupCount = 0;

  const supabase = {
    from(table: string) {
      if (table === "task_sessions") {
        return {
          select(columns: string) {
            assert.equal(columns, "id, started_at");

            const chain = {
              taskId: "",
              includeOpenOnly: false,
              eq(column: string, value: string) {
                assert.equal(column, "task_id");
                chain.taskId = value;
                return chain;
              },
              is(column: string, value: null) {
                assert.equal(column, "ended_at");
                assert.equal(value, null);
                chain.includeOpenOnly = true;
                return chain;
              },
              order(column: string) {
                assert.equal(column, "started_at");
                sessionLookupCount += 1;

                if (options?.failSessionLookup) {
                  return Promise.resolve({
                    data: null,
                    error: { message: "lookup failed" },
                  });
                }

                const data = sessions
                  .filter((session) => session.task_id === chain.taskId)
                  .filter((session) => (chain.includeOpenOnly ? session.ended_at === null : true))
                  .map((session) => ({
                    id: session.id,
                    started_at: session.started_at,
                  }));

                return Promise.resolve({ data, error: null });
              },
            };

            return chain;
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(column: string, value: string) {
                assert.equal(column, "id");
                const state = {
                  sessionId: value,
                  requireOpen: false,
                };

                return {
                  is(isColumn: string, isValue: null) {
                    assert.equal(isColumn, "ended_at");
                    assert.equal(isValue, null);
                    state.requireOpen = true;
                    return this;
                  },
                  select(columns: string) {
                    assert.equal(columns, "id");

                    return {
                      maybeSingle: async () => {
                        const session = sessions.find(
                          (item) => item.id === state.sessionId,
                        );

                        if (!session) {
                          return { data: null, error: null };
                        }

                        if (state.requireOpen && session.ended_at !== null) {
                          return { data: null, error: null };
                        }

                        sessionUpdateCalls.push({
                          payload,
                          sessionId: state.sessionId,
                        });

                        if (options?.failSessionUpdateId === state.sessionId) {
                          return {
                            data: null,
                            error: { message: "update failed" },
                          };
                        }

                        const index = sessions.findIndex(
                          (item) => item.id === state.sessionId,
                        );
                        if (index >= 0) {
                          sessions[index] = {
                            ...sessions[index],
                            ended_at: String(payload.ended_at ?? null),
                            duration_seconds: Number(payload.duration_seconds ?? 0),
                            updated_at: String(payload.updated_at ?? null),
                          };
                        }

                        return {
                          data: { id: state.sessionId },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "tasks") {
        return {
          select(columns: string) {
            assert.equal(columns, "id, status, completed_at, archived_at");
            const state = { taskId: "" };

            return {
              eq(column: string, value: string) {
                assert.equal(column, "id");
                state.taskId = value;
                return this;
              },
              maybeSingle: async () => ({
                data: tasks.find((task) => task.id === state.taskId) ?? null,
                error: null,
              }),
            };
          },
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

                    if (options?.failTaskUpdate) {
                      return { data: null, error: { message: "task update failed" } };
                    }

                    if (options?.taskUpdateReturnsNoRow) {
                      return { data: null, error: null };
                    }

                    const taskIndex = tasks.findIndex((task) => task.id === state.taskId);
                    if (taskIndex < 0) {
                      return { data: null, error: null };
                    }

                    tasks[taskIndex] = {
                      ...tasks[taskIndex],
                      status: String(payload.status ?? tasks[taskIndex].status),
                      completed_at:
                        payload.completed_at === undefined
                          ? tasks[taskIndex].completed_at
                          : (payload.completed_at as string | null),
                    };

                    return { data: { id: state.taskId }, error: null };
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
    getSessionLookupCount() {
      return sessionLookupCount;
    },
  };
}

test("marking done without an active session updates task status normally", async () => {
  const mock = createTaskInlineSupabaseMock({
    sessions: [
      {
        id: "session-closed",
        task_id: "task-1",
        started_at: "2026-04-21T08:00:00.000Z",
        ended_at: "2026-04-21T08:30:00.000Z",
      },
    ],
  });

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "done",
      priority: "medium",
      dueDate: null,
      estimateMinutes: null,
      blockedReason: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.getSessionLookupCount(), 1);
  assert.equal(mock.sessionUpdateCalls.length, 0);
  assert.equal(mock.taskUpdateCalls.length, 1);
  assert.equal(mock.taskUpdateCalls[0]?.payload.status, "done");
  assert.equal(mock.taskUpdateCalls[0]?.payload.completed_at, "2026-04-21T10:00:00.000Z");
});

test("marking an already done task done preserves completed_at", async () => {
  const mock = createTaskInlineSupabaseMock({
    tasks: [
      {
        id: "task-1",
        status: "done",
        completed_at: "2026-04-20T12:00:00.000Z",
        archived_at: null,
      },
    ],
    sessions: [
      {
        id: "session-open",
        task_id: "task-1",
        started_at: "2026-04-21T09:30:00.000Z",
        ended_at: null,
      },
    ],
  });

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "done",
      priority: "medium",
      dueDate: null,
      estimateMinutes: null,
      blockedReason: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.getSessionLookupCount(), 0);
  assert.equal(mock.sessionUpdateCalls.length, 0);
  assert.equal(mock.taskUpdateCalls[0]?.payload.completed_at, "2026-04-20T12:00:00.000Z");
});

test("editing a done task while it stays done preserves completed_at", async () => {
  const mock = createTaskInlineSupabaseMock({
    tasks: [
      {
        id: "task-1",
        status: "completed",
        completed_at: "2026-04-19T08:00:00.000Z",
        archived_at: null,
      },
    ],
    sessions: [
      {
        id: "session-open",
        task_id: "task-1",
        started_at: "2026-04-21T09:30:00.000Z",
        ended_at: null,
      },
    ],
  });

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "done",
      priority: "high",
      dueDate: "2026-04-30",
      estimateMinutes: 45,
      blockedReason: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.getSessionLookupCount(), 0);
  assert.equal(mock.sessionUpdateCalls.length, 0);
  assert.equal(mock.taskUpdateCalls[0]?.payload.completed_at, "2026-04-19T08:00:00.000Z");
  assert.equal(mock.taskUpdateCalls[0]?.payload.priority, "high");
});

test("reopening a done task clears completed_at", async () => {
  const mock = createTaskInlineSupabaseMock({
    tasks: [
      {
        id: "task-1",
        status: "done",
        completed_at: "2026-04-20T12:00:00.000Z",
        archived_at: null,
      },
    ],
  });

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "todo",
      priority: "medium",
      dueDate: null,
      estimateMinutes: null,
      blockedReason: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.taskUpdateCalls[0]?.payload.completed_at, null);
});

test("marking done with an active session stops it before updating the task", async () => {
  const mock = createTaskInlineSupabaseMock({
    sessions: [
      {
        id: "session-open",
        task_id: "task-1",
        started_at: "2026-04-21T09:30:00.000Z",
        ended_at: null,
      },
    ],
  });

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "done",
      priority: "medium",
      dueDate: null,
      estimateMinutes: null,
      blockedReason: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.getSessionLookupCount(), 1);
  assert.equal(mock.sessionUpdateCalls.length, 1);
  assert.equal(mock.sessionUpdateCalls[0]?.sessionId, "session-open");
  assert.deepEqual(mock.sessionUpdateCalls[0]?.payload, {
    ended_at: "2026-04-21T10:00:00.000Z",
    duration_seconds: 1800,
    updated_at: "2026-04-21T10:00:00.000Z",
  });
  assert.equal(mock.taskUpdateCalls.length, 1);
});

test("marking done only stops active sessions for the same task", async () => {
  const mock = createTaskInlineSupabaseMock({
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

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "done",
      priority: "medium",
      dueDate: null,
      estimateMinutes: null,
      blockedReason: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.deepEqual(
    mock.sessionUpdateCalls.map((call) => call.sessionId),
    ["session-target"],
  );
  assert.equal(mock.sessions.find((session) => session.id === "session-other")?.ended_at, null);
  assert.equal(mock.taskUpdateCalls.length, 1);
});

test("when session stop fails the task is not marked done", async () => {
  const mock = createTaskInlineSupabaseMock({
    sessions: [
      {
        id: "session-open",
        task_id: "task-1",
        started_at: "2026-04-21T09:30:00.000Z",
        ended_at: null,
      },
    ],
    failSessionUpdateId: "session-open",
  });

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "done",
      priority: "medium",
      dueDate: null,
      estimateMinutes: null,
      blockedReason: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(
    result.errorMessage,
    "Unable to stop the active timer session for this task right now.",
  );
  assert.equal(mock.taskUpdateCalls.length, 0);
});

test("non-done inline status updates do not attempt to stop timer sessions", async () => {
  const mock = createTaskInlineSupabaseMock({
    sessions: [
      {
        id: "session-open",
        task_id: "task-1",
        started_at: "2026-04-21T09:30:00.000Z",
        ended_at: null,
      },
    ],
  });

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "in_progress",
      priority: "medium",
      dueDate: null,
      estimateMinutes: null,
      blockedReason: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.getSessionLookupCount(), 0);
  assert.equal(mock.sessionUpdateCalls.length, 0);
  assert.equal(mock.taskUpdateCalls.length, 1);
});

test("no-row task update failure returns a clear error", async () => {
  const mock = createTaskInlineSupabaseMock({
    taskUpdateReturnsNoRow: true,
  });

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "in_progress",
      priority: "medium",
      dueDate: null,
      estimateMinutes: null,
      blockedReason: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, "Task was not found or is no longer available.");
});

function createTaskCreateSupabaseMock(options?: {
  failTaskInsert?: boolean;
  failSessionInsert?: boolean;
  taskInsertReturnsNoId?: boolean;
  projectRows?: Array<{ id: string }>;
  goalRows?: Array<{ id: string; project_id: string }>;
}) {
  const taskInsertCalls: Array<Record<string, unknown>[]> = [];
  const sessionInsertCalls: Array<Record<string, unknown>> = [];
  const tasks = [{ id: "task-1" }];

  const supabase = {
    from(table: string) {
      if (table === "projects") {
        return {
          select: async (columns: string) => {
            assert.equal(columns, "id");
            return { data: options?.projectRows ?? [{ id: "project-1" }], error: null };
          },
        };
      }

      if (table === "goals") {
        return {
          select: async (columns: string) => {
            assert.equal(columns, "id, project_id");
            return {
              data: options?.goalRows ?? [{ id: "goal-1", project_id: "project-1" }],
              error: null,
            };
          },
        };
      }

      if (table === "tasks") {
        return {
          insert(rows: Record<string, unknown>[]) {
            taskInsertCalls.push(rows);
            return {
              select: async (columns: string) => {
                assert.equal(columns, "id");
                if (options?.failTaskInsert) {
                  return { data: null, error: { message: "insert failed" } };
                }
                if (options?.taskInsertReturnsNoId) {
                  return { data: [], error: null };
                }
                return { data: tasks, error: null };
              },
            };
          },
        };
      }

      if (table === "task_sessions") {
        return {
          insert: async (row: Record<string, unknown>) => {
            sessionInsertCalls.push(row);
            return {
              data: null,
              error: options?.failSessionInsert ? { message: "session failed" } : null,
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return {
    supabase: supabase as never,
    taskInsertCalls,
    sessionInsertCalls,
  };
}

test("createTasks rejects invalid project scope before insert", async () => {
  const mock = createTaskCreateSupabaseMock({ projectRows: [{ id: "project-1" }] });

  const result = await createTasks(
    [
      {
        title: "Out of scope",
        project_id: "project-missing",
        goal_id: null,
        status: "todo",
        priority: "medium",
      },
    ],
    { supabase: mock.supabase },
  );

  assert.deepEqual(result, { errorMessage: "Selected project is unavailable." });
  assert.equal(mock.taskInsertCalls.length, 0);
});

test("createTasks rejects goal outside project scope before insert", async () => {
  const mock = createTaskCreateSupabaseMock({
    projectRows: [{ id: "project-1" }, { id: "project-2" }],
    goalRows: [{ id: "goal-2", project_id: "project-2" }],
  });

  const result = await createTasks(
    [
      {
        title: "Cross-project goal",
        project_id: "project-1",
        goal_id: "goal-2",
        status: "todo",
        priority: "medium",
      },
    ],
    { supabase: mock.supabase },
  );

  assert.deepEqual(result, {
    errorMessage: "Selected goal does not belong to the chosen project.",
  });
  assert.equal(mock.taskInsertCalls.length, 0);
});

test("createTasks rejects blocked task without reason before insert", async () => {
  const mock = createTaskCreateSupabaseMock({ projectRows: [{ id: "project-1" }] });

  const result = await createTasks(
    [
      {
        title: "Blocked without reason",
        project_id: "project-1",
        goal_id: null,
        status: "blocked",
        blocked_reason: "",
        priority: "medium",
      },
    ],
    { supabase: mock.supabase },
  );

  assert.deepEqual(result, {
    errorMessage: "Blocked reason is required when status is Blocked.",
  });
  assert.equal(mock.taskInsertCalls.length, 0);
});

test("createTasks still inserts valid project-scoped rows through shared path", async () => {
  const mock = createTaskCreateSupabaseMock({ projectRows: [{ id: "project-1" }] });

  const result = await createTasks(
    [
      {
        title: "In scope",
        project_id: "project-1",
        goal_id: null,
        status: "todo",
        priority: "medium",
      },
    ],
    { supabase: mock.supabase },
  );

  assert.equal(result.errorMessage, null);
  assert.deepEqual(result.createdTaskIds, ["task-1"]);
  assert.equal(mock.taskInsertCalls.length, 1);
  assert.equal(mock.taskInsertCalls[0]?.[0]?.title, "In scope");
});

test("createTaskWithOptionalWorkedTime creates a task without worked time as before", async () => {
  const mock = createTaskCreateSupabaseMock();

  const result = await createTaskWithOptionalWorkedTime(
    {
      task: {
        title: "Plan review",
        project_id: "project-1",
        goal_id: null,
        status: "todo",
        priority: "medium",
      },
      workedTime: null,
    },
    { supabase: mock.supabase },
  );

  assert.deepEqual(result, {
    errorMessage: null,
    createdTaskId: "task-1",
    workedTimeLogged: false,
  });
  assert.equal(mock.taskInsertCalls.length, 1);
  assert.equal(mock.sessionInsertCalls.length, 0);
});

test("createTaskWithOptionalWorkedTime logs exactly one completed session", async () => {
  const mock = createTaskCreateSupabaseMock();

  const result = await createTaskWithOptionalWorkedTime(
    {
      task: {
        title: "Draft spec",
        project_id: "project-1",
        goal_id: null,
        status: "blocked",
        blocked_reason: "Waiting on API",
        priority: "high",
      },
      workedTime: {
        started_at: "2026-04-30T09:00:00.000Z",
        ended_at: "2026-04-30T10:30:00.000Z",
        duration_seconds: 5400,
      },
    },
    { supabase: mock.supabase },
  );

  assert.deepEqual(result, {
    errorMessage: null,
    createdTaskId: "task-1",
    workedTimeLogged: true,
  });
  assert.equal(mock.sessionInsertCalls.length, 1);
  assert.deepEqual(mock.sessionInsertCalls[0], {
    task_id: "task-1",
    started_at: "2026-04-30T09:00:00.000Z",
    ended_at: "2026-04-30T10:30:00.000Z",
    duration_seconds: 5400,
  });
  assert.equal(mock.taskInsertCalls[0]?.[0]?.status, "blocked");
});

test("createTaskWithOptionalWorkedTime does not log worked time when task creation fails", async () => {
  const mock = createTaskCreateSupabaseMock({ failTaskInsert: true });

  const result = await createTaskWithOptionalWorkedTime(
    {
      task: {
        title: "Draft spec",
        project_id: "project-1",
        goal_id: null,
        status: "todo",
        priority: "medium",
      },
      workedTime: {
        started_at: "2026-04-30T09:00:00.000Z",
        ended_at: "2026-04-30T10:00:00.000Z",
        duration_seconds: 3600,
      },
    },
    { supabase: mock.supabase },
  );

  assert.deepEqual(result, {
    errorMessage: "Unable to create task right now.",
    createdTaskId: null,
    workedTimeLogged: false,
  });
  assert.equal(mock.taskInsertCalls.length, 1);
  assert.equal(mock.sessionInsertCalls.length, 0);
});

test("createTaskWithOptionalWorkedTime requires the created task id before logging worked time", async () => {
  const mock = createTaskCreateSupabaseMock({ taskInsertReturnsNoId: true });

  const result = await createTaskWithOptionalWorkedTime(
    {
      task: {
        title: "Draft spec",
        project_id: "project-1",
        goal_id: null,
        status: "todo",
        priority: "medium",
      },
      workedTime: {
        started_at: "2026-04-30T09:00:00.000Z",
        ended_at: "2026-04-30T10:00:00.000Z",
        duration_seconds: 3600,
      },
    },
    { supabase: mock.supabase },
  );

  assert.deepEqual(result, {
    errorMessage: "Task created, but worked time could not be logged.",
    createdTaskId: null,
    workedTimeLogged: false,
  });
  assert.equal(mock.taskInsertCalls.length, 1);
  assert.equal(mock.sessionInsertCalls.length, 0);
});

test("createTaskWithOptionalWorkedTime reports session failure without claiming logged time", async () => {
  const mock = createTaskCreateSupabaseMock({ failSessionInsert: true });

  const result = await createTaskWithOptionalWorkedTime(
    {
      task: {
        title: "Draft spec",
        project_id: "project-1",
        goal_id: null,
        status: "done",
        priority: "medium",
      },
      workedTime: {
        started_at: "2026-04-30T09:00:00.000Z",
        ended_at: "2026-04-30T10:00:00.000Z",
        duration_seconds: 3600,
      },
    },
    { supabase: mock.supabase },
  );

  assert.equal(result.errorMessage, "Task created, but worked time could not be logged.");
  assert.equal(result.createdTaskId, "task-1");
  assert.equal(result.workedTimeLogged, false);
  assert.equal(mock.sessionInsertCalls.length, 1);
});

function createWorkspaceSupabaseMock() {
  const taskQueryCalls: Array<{ method: string; column: string; value: unknown }> = [];
  const tasks = [
    {
      id: "deep-work-task",
      title: "Write architecture note",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "urgent",
      due_date: null,
      estimate_minutes: 45,
      updated_at: "2026-04-30T10:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: { name: "EGA House" },
      goals: null,
    },
    {
      id: "quick-win-task",
      title: "Send update",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: null,
      estimate_minutes: 15,
      updated_at: "2026-04-30T11:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: { name: "EGA House" },
      goals: null,
    },
    {
      id: "too-large-task",
      title: "Refactor module",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: null,
      estimate_minutes: 16,
      updated_at: "2026-04-30T11:30:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: { name: "EGA House" },
      goals: null,
    },
    {
      id: "blocked-task",
      title: "Waiting on credentials",
      description: null,
      blocked_reason: "Vendor access",
      status: "blocked",
      priority: "high",
      due_date: null,
      estimate_minutes: 25,
      updated_at: "2026-04-30T12:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: { name: "EGA House" },
      goals: null,
    },
    {
      id: "due-today-task",
      title: "Due today",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: "2026-05-01",
      estimate_minutes: 20,
      updated_at: "2026-04-30T13:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: { name: "EGA House" },
      goals: null,
    },
    {
      id: "due-end-task",
      title: "Due end",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: "2026-05-08",
      estimate_minutes: 20,
      updated_at: "2026-04-30T14:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: { name: "EGA House" },
      goals: null,
    },
    {
      id: "due-null-task",
      title: "No due date",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: null,
      estimate_minutes: 20,
      updated_at: "2026-04-30T15:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: { name: "EGA House" },
      goals: null,
    },
    {
      id: "due-out-of-range-task",
      title: "Due later",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: "2026-05-09",
      estimate_minutes: 20,
      updated_at: "2026-04-30T16:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: { name: "EGA House" },
      goals: null,
    },
    {
      id: "archived-quick-win-task",
      title: "Archived quick win",
      description: null,
      blocked_reason: null,
      status: "todo",
      priority: "medium",
      due_date: null,
      estimate_minutes: 10,
      updated_at: "2026-04-30T17:00:00.000Z",
      completed_at: null,
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: "2026-04-30T18:00:00.000Z",
      archived_by: "user-1",
      projects: { name: "EGA House" },
      goals: null,
    },
    {
      id: "done-task",
      title: "Done",
      description: null,
      blocked_reason: null,
      status: "done",
      priority: "urgent",
      due_date: null,
      estimate_minutes: 60,
      updated_at: "2026-04-30T09:00:00.000Z",
      completed_at: "2026-04-30T09:30:00.000Z",
      project_id: "project-1",
      goal_id: null,
      focus_rank: null,
      planned_for_date: null,
      archived_at: null,
      archived_by: null,
      projects: { name: "EGA House" },
      goals: null,
    },
  ];
  const savedViews = [
    {
      id: "custom-view",
      name: "Custom",
      status: "todo",
      project_id: null,
      goal_id: null,
      due_filter: "all",
      sort_value: "updated_desc",
      definition_json: null,
      updated_at: "2026-04-29T00:00:00.000Z",
    },
  ];

  function createTasksQuery(columns: string) {
    const state = {
      activeOnly: false,
      excludeDone: false,
      priorities: null as string[] | null,
      estimateMin: null as number | null,
      estimateMax: null as number | null,
      status: null as string | null,
      dueStart: null as string | null,
      dueEnd: null as string | null,
    };

    const execute = async () => {
      if (columns === "archived_at") {
        return {
          data: tasks.map((task) => ({ archived_at: task.archived_at })),
          error: null,
        };
      }

      return {
        data: tasks
          .filter((task) => (state.activeOnly ? task.archived_at === null : true))
          .filter((task) => (state.excludeDone ? task.status !== "done" : true))
          .filter((task) => (state.priorities ? state.priorities.includes(task.priority) : true))
          .filter((task) =>
            state.estimateMin === null
              ? true
              : (task.estimate_minutes ?? 0) >= state.estimateMin,
          )
          .filter((task) =>
            state.estimateMax === null
              ? true
              : task.estimate_minutes !== null && task.estimate_minutes <= state.estimateMax,
          )
          .filter((task) => (state.status ? task.status === state.status : true))
          .filter((task) =>
            state.dueStart === null
              ? true
              : task.due_date !== null && task.due_date >= state.dueStart,
          )
          .filter((task) =>
            state.dueEnd === null
              ? true
              : task.due_date !== null && task.due_date <= state.dueEnd,
          ),
        error: null,
      };
    };

    const query = {
      is(column: string, value: null) {
        taskQueryCalls.push({ method: "is", column, value });
        if (column === "archived_at") {
          state.activeOnly = true;
        }
        return query;
      },
      neq(column: string, value: string) {
        taskQueryCalls.push({ method: "neq", column, value });
        if (column === "status" && value === "done") {
          state.excludeDone = true;
        }
        return query;
      },
      in(column: string, value: string[]) {
        taskQueryCalls.push({ method: "in", column, value });
        if (column === "priority") {
          state.priorities = value;
        }
        return query;
      },
      gte(column: string, value: number | string) {
        taskQueryCalls.push({ method: "gte", column, value });
        if (column === "estimate_minutes") {
          state.estimateMin = Number(value);
        }
        if (column === "due_date") {
          state.dueStart = String(value);
        }
        return query;
      },
      lte(column: string, value: number | string) {
        taskQueryCalls.push({ method: "lte", column, value });
        if (column === "estimate_minutes") {
          state.estimateMax = Number(value);
        }
        if (column === "due_date") {
          state.dueEnd = String(value);
        }
        return query;
      },
      eq(column: string, value: string) {
        taskQueryCalls.push({ method: "eq", column, value });
        if (column === "status") {
          state.status = value;
        }
        return query;
      },
      not(column: string, operator: string, value: unknown) {
        taskQueryCalls.push({ method: `not.${operator}`, column, value });
        return query;
      },
      order() {
        return query;
      },
      then(
        resolve: (value: { data: typeof tasks | Array<{ archived_at: string | null }>; error: null }) => void,
        reject?: (reason: unknown) => void,
      ) {
        return execute().then(resolve, reject);
      },
    };

    return query;
  }

  const supabase = {
    from(table: string) {
      if (table === "projects") {
        return {
          select: () => ({
            order: async () => ({ data: [{ id: "project-1", name: "EGA House" }], error: null }),
          }),
        };
      }

      if (table === "goals") {
        return {
          select: () => ({
            order: async () => ({ data: [], error: null }),
          }),
        };
      }

      if (table === "task_saved_views") {
        return {
          select: () => ({
            order: async () => ({ data: savedViews, error: null }),
          }),
        };
      }

      if (table === "tasks") {
        return {
          select(columns: string) {
            return createTasksQuery(columns);
          },
        };
      }

      if (table === "task_sessions") {
        return {
          select: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase: supabase as never, taskQueryCalls };
}

test("Deep Work default view applies active priority and estimate constraints", async () => {
  const mock = createWorkspaceSupabaseMock();

  const result = await getTasksWorkspaceData(
    {
      activeStatus: null,
      requestedProjectId: null,
      requestedGoalId: null,
      activeDueFilter: "all",
      activeSort: "updated_desc",
      activeView: "active",
      activeTasksOnly: true,
      activePriorityValues: ["urgent", "high"],
      activeEstimateMinMinutes: 30,
    },
    { supabase: mock.supabase },
  );

  assert.equal(result.savedViews[0]?.name, "Deep Work");
  assert.equal(result.savedViews[0]?.is_default, true);
  assert.deepEqual(result.tasks.map((task) => task.id), ["deep-work-task"]);
  assert.deepEqual(
    mock.taskQueryCalls.filter((call) => ["is", "neq", "in", "gte"].includes(call.method)),
    [
      { method: "is", column: "archived_at", value: null },
      { method: "neq", column: "status", value: "done" },
      { method: "in", column: "priority", value: ["urgent", "high"] },
      { method: "gte", column: "estimate_minutes", value: 30 },
    ],
  );
});

test("workspace data returns all system defaults before custom views", async () => {
  const mock = createWorkspaceSupabaseMock();

  const result = await getTasksWorkspaceData(
    {
      activeStatus: null,
      requestedProjectId: null,
      requestedGoalId: null,
      activeDueFilter: "all",
      activeSort: "updated_desc",
      activeView: "active",
    },
    { supabase: mock.supabase },
  );

  assert.deepEqual(
    result.savedViews.map((view) => ({ name: view.name, isDefault: view.is_default === true })),
    [
      { name: "Deep Work", isDefault: true },
      { name: "Quick Wins", isDefault: true },
      { name: "Blocked", isDefault: true },
      { name: "Due This Week", isDefault: true },
      { name: "Custom", isDefault: false },
    ],
  );
});

test("Quick Wins default view filters active tasks by estimate max", async () => {
  const mock = createWorkspaceSupabaseMock();

  const result = await getTasksWorkspaceData(
    {
      activeStatus: null,
      requestedProjectId: null,
      requestedGoalId: null,
      activeDueFilter: "all",
      activeSort: "updated_desc",
      activeView: "active",
      activeTasksOnly: true,
      activeEstimateMaxMinutes: 15,
    },
    { supabase: mock.supabase },
  );

  assert.deepEqual(result.tasks.map((task) => task.id), ["quick-win-task"]);
  assert.deepEqual(
    mock.taskQueryCalls.filter((call) => call.method === "lte"),
    [{ method: "lte", column: "estimate_minutes", value: 15 }],
  );
});

test("Blocked default view filters active blocked tasks", async () => {
  const mock = createWorkspaceSupabaseMock();

  const result = await getTasksWorkspaceData(
    {
      activeStatus: "blocked",
      requestedProjectId: null,
      requestedGoalId: null,
      activeDueFilter: "all",
      activeSort: "updated_desc",
      activeView: "active",
      activeTasksOnly: true,
    },
    { supabase: mock.supabase },
  );

  assert.deepEqual(result.tasks.map((task) => task.id), ["blocked-task"]);
  assert.deepEqual(
    mock.taskQueryCalls.filter((call) => call.method === "eq"),
    [{ method: "eq", column: "status", value: "blocked" }],
  );
});

test("Due This Week default view includes today through today plus seven days", async () => {
  const mock = createWorkspaceSupabaseMock();

  const result = await getTasksWorkspaceData(
    {
      activeStatus: null,
      requestedProjectId: null,
      requestedGoalId: null,
      activeDueFilter: "all",
      activeSort: "due_date_asc",
      activeView: "active",
      activeTasksOnly: true,
      activeDueWithinDays: 7,
    },
    { supabase: mock.supabase, todayIsoDate: "2026-05-01" },
  );

  assert.deepEqual(result.tasks.map((task) => task.id), ["due-today-task", "due-end-task"]);
  assert.deepEqual(
    mock.taskQueryCalls.filter((call) => call.method === "gte" || call.method === "lte"),
    [
      { method: "gte", column: "due_date", value: "2026-05-01" },
      { method: "lte", column: "due_date", value: "2026-05-08" },
    ],
  );
});
