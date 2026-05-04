import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelTaskReminder,
  createTaskEmailReminder,
  createTasks,
  createTaskWithOptionalWorkedTime,
  getTaskRecurrencesForTasks,
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
  owner_user_id?: string | null;
  project_id?: string;
  goal_id?: string | null;
  title?: string;
  description?: string | null;
  status: string;
  priority?: string;
  due_date?: string | null;
  planned_for_date?: string | null;
  estimate_minutes?: number | null;
  focus_rank?: number | null;
  completed_at: string | null;
  archived_at: string | null;
  archived_by?: string | null;
};

type MockRecurrence = {
  id: string;
  task_id: string;
  rule: string;
  anchor_date: string;
  timezone: string;
  next_occurrence_date: string;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
  owner_user_id?: string | null;
};

function createTaskInlineSupabaseMock(options?: {
  tasks?: MockTask[];
  sessions?: MockSession[];
  recurrences?: MockRecurrence[];
  failSessionLookup?: boolean;
  failSessionUpdateId?: string;
  failTaskUpdate?: boolean;
  taskUpdateReturnsNoRow?: boolean;
}) {
  const tasks = (options?.tasks ?? [
      {
        id: "task-1",
        owner_user_id: "user-1",
        project_id: "project-1",
        goal_id: null,
        title: "Write plan",
        description: null,
        status: "todo",
        priority: "medium",
        due_date: null,
        planned_for_date: null,
        estimate_minutes: null,
        focus_rank: null,
        completed_at: null,
        archived_at: null,
        archived_by: null,
      },
    ]).map((task) => ({
      owner_user_id: "user-1",
      project_id: "project-1",
      goal_id: null,
      title: "Write plan",
      description: null,
      priority: "medium",
      due_date: null,
      planned_for_date: null,
      estimate_minutes: null,
      focus_rank: null,
      archived_by: null,
      ...task,
    }));
  const sessions = [...(options?.sessions ?? [])];
  const recurrences = [...(options?.recurrences ?? [])];
  const taskUpdateCalls: Array<{ payload: Record<string, unknown>; taskId: string }> = [];
  const taskInsertCalls: Array<Record<string, unknown>> = [];
  const sessionUpdateCalls: Array<{ payload: Record<string, unknown>; sessionId: string }> = [];
  const recurrenceUpdateCalls: Array<Record<string, unknown>> = [];
  const recurrenceInsertCalls: Array<Record<string, unknown>> = [];
  const recurrenceDeleteTaskIds: string[] = [];
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
            assert.ok(
              columns === "id, status, completed_at, archived_at" ||
                columns === "id" ||
                columns ===
                  "id, owner_user_id, project_id, goal_id, title, description, priority, estimate_minutes",
            );
            const state = {
              taskId: "",
              projectId: null as string | null,
              goalId: undefined as string | null | undefined,
              title: null as string | null,
              dueDate: null as string | null,
              excludeId: null as string | null,
              ownerUserId: null as string | null,
            };

            const query = {
              eq(column: string, value: string) {
                if (column === "id") {
                  state.taskId = value;
                } else if (column === "project_id") {
                  state.projectId = value;
                } else if (column === "goal_id") {
                  state.goalId = value;
                } else if (column === "title") {
                  state.title = value;
                } else if (column === "due_date") {
                  state.dueDate = value;
                } else if (column === "owner_user_id") {
                  state.ownerUserId = value;
                } else {
                  assert.fail(`Unexpected task eq column: ${column}`);
                }
                return query;
              },
              neq(column: string, value: string) {
                assert.equal(column, "id");
                state.excludeId = value;
                return query;
              },
              is(column: string, value: null) {
                assert.equal(column, "goal_id");
                assert.equal(value, null);
                state.goalId = null;
                return query;
              },
              limit(value: number) {
                assert.equal(value, 1);
                return query;
              },
              maybeSingle: async () => {
                const data =
                  columns === "id" && !state.taskId
                    ? tasks.find((task) =>
                        task.project_id === state.projectId &&
                        task.goal_id === state.goalId &&
                        task.title === state.title &&
                        task.due_date === state.dueDate &&
                        task.id !== state.excludeId &&
                        (!state.ownerUserId || task.owner_user_id === state.ownerUserId),
                      ) ?? null
                    : tasks.find((task) => task.id === state.taskId) ?? null;
                return { data, error: null };
              },
            };

            return query;
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
          insert(row: Record<string, unknown>) {
            taskInsertCalls.push(row);
            const createdId = `task-generated-${taskInsertCalls.length}`;
            tasks.push({
              id: createdId,
              owner_user_id: (row.owner_user_id as string | null) ?? null,
              project_id: String(row.project_id),
              goal_id: (row.goal_id as string | null) ?? null,
              title: String(row.title),
              description: (row.description as string | null) ?? null,
              status: String(row.status ?? "todo"),
              priority: String(row.priority ?? "medium"),
              due_date: (row.due_date as string | null) ?? null,
              planned_for_date: (row.planned_for_date as string | null) ?? null,
              estimate_minutes: (row.estimate_minutes as number | null) ?? null,
              focus_rank: (row.focus_rank as number | null) ?? null,
              completed_at: (row.completed_at as string | null) ?? null,
              archived_at: (row.archived_at as string | null) ?? null,
              archived_by: (row.archived_by as string | null) ?? null,
            });
            return {
              select(columns: string) {
                assert.equal(columns, "id");
                return {
                  maybeSingle: async () => ({ data: { id: createdId }, error: null }),
                };
              },
            };
          },
        };
      }

      if (table === "task_recurrences") {
        return {
          select: (columns: string) => {
            const state = { taskId: "" };
            return {
              eq(column: string, value: string) {
                assert.equal(column, "task_id");
                state.taskId = value;
                return this;
              },
              maybeSingle: async () => {
                if (columns === "id") {
                  return { data: { id: "recurrence-1" }, error: null };
                }

                return {
                  data: recurrences.find((recurrence) => recurrence.task_id === state.taskId) ?? null,
                  error: null,
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            recurrenceUpdateCalls.push(payload);
            const state = {
              id: "",
              taskId: "",
              requireLastGeneratedNull: false,
            };
            return {
              eq(column: string, value: string) {
                if (column === "id") {
                  state.id = value;
                } else if (column === "task_id") {
                  state.taskId = value;
                }
                return this;
              },
              is(column: string, value: null) {
                assert.equal(column, "last_generated_at");
                assert.equal(value, null);
                state.requireLastGeneratedNull = true;
                return this;
              },
              select(columns: string) {
                assert.equal(columns, "id");
                return {
                  maybeSingle: async () => {
                    const recurrence = recurrences.find((item) => item.id === state.id);
                    if (!recurrence) {
                      return { data: null, error: null };
                    }
                    if (
                      state.requireLastGeneratedNull &&
                      recurrence.last_generated_at !== null
                    ) {
                      return { data: null, error: null };
                    }
                    Object.assign(recurrence, payload);
                    return { data: { id: recurrence.id }, error: null };
                  },
                };
              },
              then(resolve: (value: { data: null; error: null }) => void) {
                const recurrence = recurrences.find(
                  (item) =>
                    (state.id && item.id === state.id) ||
                    (state.taskId && item.task_id === state.taskId),
                );
                if (recurrence) {
                  Object.assign(recurrence, payload);
                }
                return Promise.resolve({ data: null, error: null }).then(resolve);
              },
            };
          },
          delete() {
            return {
              eq: async (_column: string, value: string) => {
                recurrenceDeleteTaskIds.push(value);
                return { data: null, error: null };
              },
            };
          },
          insert: async (row: Record<string, unknown>) => {
            recurrenceInsertCalls.push(row);
            recurrences.push({
              id: `recurrence-generated-${recurrenceInsertCalls.length}`,
              task_id: String(row.task_id),
              rule: String(row.rule),
              anchor_date: String(row.anchor_date),
              timezone: String(row.timezone),
              next_occurrence_date: String(row.next_occurrence_date),
              last_generated_at: (row.last_generated_at as string | null) ?? null,
              created_at: "2026-04-21T10:00:00.000Z",
              updated_at: String(row.updated_at ?? "2026-04-21T10:00:00.000Z"),
              owner_user_id: (row.owner_user_id as string | null) ?? null,
            });
            return { data: null, error: null };
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
    recurrences,
    taskUpdateCalls,
    taskInsertCalls,
    sessionUpdateCalls,
    recurrenceUpdateCalls,
    recurrenceInsertCalls,
    recurrenceDeleteTaskIds,
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

test("inline update persists recurrence preset when provided", async () => {
  const mock = createTaskInlineSupabaseMock();

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "todo",
      priority: "medium",
      dueDate: null,
      estimateMinutes: null,
      blockedReason: null,
      recurrenceRule: "weekly:monday",
      recurrenceAnchorDate: "2026-05-04",
      recurrenceTimezone: "UTC",
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.deepEqual(mock.recurrenceUpdateCalls, [
    {
      rule: "weekly:monday",
      anchor_date: "2026-05-04",
      timezone: "UTC",
      next_occurrence_date: "2026-05-11",
      last_generated_at: null,
      updated_at: "2026-04-21T10:00:00.000Z",
    },
  ]);
});

test("inline validation rejects invalid recurrence anchor date", () => {
  const result = validateTaskInlineUpdateInput({
    taskId: "task-1",
    status: "todo",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    blockedReason: "",
    recurrenceRule: "daily",
    recurrenceAnchorDate: "2026-02-30",
    recurrenceTimezone: "UTC",
  });

  assert.equal(result.errorMessage, "Recurring anchor date is invalid.");
});

test("inline validation rejects invalid recurrence timezone", () => {
  const result = validateTaskInlineUpdateInput({
    taskId: "task-1",
    status: "todo",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    blockedReason: "",
    recurrenceRule: "daily",
    recurrenceAnchorDate: "2026-05-04",
    recurrenceTimezone: "Mars/Base",
  });

  assert.equal(result.errorMessage, "Recurring timezone is invalid.");
});

test("inline update clears recurrence preset when empty rule provided", async () => {
  const mock = createTaskInlineSupabaseMock();

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "todo",
      priority: "medium",
      dueDate: null,
      estimateMinutes: null,
      blockedReason: null,
      recurrenceRule: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-04-21T10:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.deepEqual(mock.recurrenceDeleteTaskIds, ["task-1"]);
});

function createDailyRecurrence(overrides?: Partial<MockRecurrence>): MockRecurrence {
  return {
    id: "recurrence-1",
    task_id: "task-1",
    rule: "daily",
    anchor_date: "2026-05-01",
    timezone: "UTC",
    next_occurrence_date: "2026-05-05",
    last_generated_at: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    owner_user_id: "user-1",
    ...overrides,
  };
}

test("completing a recurring task creates exactly one next task with carried metadata", async () => {
  const mock = createTaskInlineSupabaseMock({
    tasks: [
      {
        id: "task-1",
        owner_user_id: "user-1",
        project_id: "project-1",
        goal_id: "goal-1",
        title: "Daily execution review",
        description: "Capture evidence",
        status: "todo",
        priority: "high",
        due_date: "2026-05-04",
        estimate_minutes: 30,
        completed_at: null,
        archived_at: null,
      },
    ],
    recurrences: [createDailyRecurrence()],
  });

  const result = await updateTaskInline(
    {
      taskId: "task-1",
      status: "done",
      priority: "high",
      dueDate: "2026-05-04",
      estimateMinutes: 30,
      blockedReason: null,
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-05-04T16:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.taskInsertCalls.length, 1);
  assert.deepEqual(mock.taskInsertCalls[0], {
    owner_user_id: "user-1",
    project_id: "project-1",
    goal_id: "goal-1",
    title: "Daily execution review",
    description: "Capture evidence",
    blocked_reason: null,
    status: "todo",
    priority: "high",
    due_date: "2026-05-05",
    planned_for_date: null,
    estimate_minutes: 30,
    focus_rank: null,
    completed_at: null,
    archived_at: null,
    archived_by: null,
    updated_at: "2026-05-04T16:00:00.000Z",
  });
  assert.deepEqual(mock.recurrenceInsertCalls[0], {
    owner_user_id: "user-1",
    task_id: "task-generated-1",
    rule: "daily",
    anchor_date: "2026-05-01",
    timezone: "UTC",
    next_occurrence_date: "2026-05-06",
    last_generated_at: null,
    updated_at: "2026-05-04T16:00:00.000Z",
  });
  assert.equal(mock.recurrences[0]?.last_generated_at, "2026-05-04T16:00:00.000Z");
  assert.equal(mock.recurrences[0]?.next_occurrence_date, "2026-05-06");
  assert.equal(mock.tasks.find((task) => task.id === "task-1")?.status, "done");
  assert.equal(
    mock.tasks.find((task) => task.id === "task-1")?.completed_at,
    "2026-05-04T16:00:00.000Z",
  );
});

test("completing a non-recurring task creates no next task", async () => {
  const mock = createTaskInlineSupabaseMock();

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
      updatedAtIso: "2026-05-04T16:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.taskInsertCalls.length, 0);
  assert.equal(mock.recurrenceInsertCalls.length, 0);
});

test("recurring task completion retry does not duplicate generated future task", async () => {
  const mock = createTaskInlineSupabaseMock({
    tasks: [
      {
        id: "task-1",
        status: "todo",
        completed_at: null,
        archived_at: null,
      },
    ],
    recurrences: [createDailyRecurrence()],
  });

  const first = await updateTaskInline(
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
      updatedAtIso: "2026-05-04T16:00:00.000Z",
    },
  );
  const retry = await updateTaskInline(
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
      updatedAtIso: "2026-05-04T16:00:01.000Z",
    },
  );

  assert.equal(first.errorMessage, null);
  assert.equal(retry.errorMessage, null);
  assert.equal(mock.taskInsertCalls.length, 1);
  assert.equal(mock.recurrenceInsertCalls.length, 1);
});

test("recurring completion skips missed occurrences and uses first valid future date", async () => {
  const mock = createTaskInlineSupabaseMock({
    recurrences: [
      createDailyRecurrence({
        next_occurrence_date: "2026-05-02",
      }),
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
      updatedAtIso: "2026-05-04T16:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.taskInsertCalls[0]?.due_date, "2026-05-05");
  assert.equal(mock.recurrences[0]?.next_occurrence_date, "2026-05-06");
});

test("inline validation rejects invalid recurrence preset", () => {
  const result = validateTaskInlineUpdateInput({
    taskId: "task-1",
    status: "todo",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    blockedReason: "",
    recurrenceRule: "annually",
  });

  assert.equal(result.errorMessage, "Recurring preset is not supported.");
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
  const recurrenceInsertCalls: Array<Record<string, unknown>> = [];
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
          select(columns: string) {
            assert.equal(columns, "id");
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

      if (table === "task_recurrences") {
        return {
          insert: async (row: Record<string, unknown>) => {
            recurrenceInsertCalls.push(row);
            return { data: null, error: null };
          },
          delete() {
            return {
              eq: async () => ({ data: null, error: null }),
            };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return {
    supabase: supabase as never,
    taskInsertCalls,
    sessionInsertCalls,
    recurrenceInsertCalls,
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

test("createTaskWithOptionalWorkedTime persists a valid recurrence preset", async () => {
  const mock = createTaskCreateSupabaseMock();

  const result = await createTaskWithOptionalWorkedTime(
    {
      task: {
        title: "Standup",
        project_id: "project-1",
        goal_id: null,
        status: "todo",
        priority: "medium",
      },
      workedTime: null,
      recurrenceRule: "weekdays",
      recurrenceAnchorDate: "2026-05-08",
      recurrenceTimezone: "UTC",
    },
    { supabase: mock.supabase },
  );

  assert.equal(result.errorMessage, null);
  assert.deepEqual(mock.recurrenceInsertCalls, [
    {
      task_id: "task-1",
      rule: "weekdays",
      anchor_date: "2026-05-08",
      timezone: "UTC",
      next_occurrence_date: "2026-05-11",
      last_generated_at: null,
    },
  ]);
});

for (const [rule, anchorDate, nextOccurrenceDate] of [
  ["daily", "2026-05-04", "2026-05-05"],
  ["weekdays", "2026-05-08", "2026-05-11"],
  ["weekly:wednesday", "2026-05-04", "2026-05-06"],
  ["monthly:day-of-month", "2026-01-31", "2026-02-28"],
] as const) {
  test(`createTaskWithOptionalWorkedTime persists next occurrence for ${rule}`, async () => {
    const mock = createTaskCreateSupabaseMock();

    const result = await createTaskWithOptionalWorkedTime(
      {
        task: {
          title: "Recurring",
          project_id: "project-1",
          goal_id: null,
          status: "todo",
          priority: "medium",
        },
        workedTime: null,
        recurrenceRule: rule,
        recurrenceAnchorDate: anchorDate,
        recurrenceTimezone: "UTC",
      },
      { supabase: mock.supabase },
    );

    assert.equal(result.errorMessage, null);
    assert.deepEqual(mock.recurrenceInsertCalls, [
      {
        task_id: "task-1",
        rule,
        anchor_date: anchorDate,
        timezone: "UTC",
        next_occurrence_date: nextOccurrenceDate,
        last_generated_at: null,
      },
    ]);
  });
}

test("createTaskWithOptionalWorkedTime rejects invalid recurrence before task insert", async () => {
  const mock = createTaskCreateSupabaseMock();

  const result = await createTaskWithOptionalWorkedTime(
    {
      task: {
        title: "Invalid repeat",
        project_id: "project-1",
        goal_id: null,
        status: "todo",
        priority: "medium",
      },
      workedTime: null,
      recurrenceRule: "yearly",
    },
    { supabase: mock.supabase },
  );

  assert.equal(result.errorMessage, "Recurring preset is not supported.");
  assert.equal(mock.taskInsertCalls.length, 0);
  assert.equal(mock.recurrenceInsertCalls.length, 0);
});

test("createTaskWithOptionalWorkedTime rejects invalid recurrence anchor before task insert", async () => {
  const mock = createTaskCreateSupabaseMock();

  const result = await createTaskWithOptionalWorkedTime(
    {
      task: {
        title: "Invalid anchor",
        project_id: "project-1",
        goal_id: null,
        status: "todo",
        priority: "medium",
      },
      workedTime: null,
      recurrenceRule: "daily",
      recurrenceAnchorDate: "not-a-date",
      recurrenceTimezone: "UTC",
    },
    { supabase: mock.supabase },
  );

  assert.equal(result.errorMessage, "Recurring anchor date is invalid.");
  assert.equal(mock.taskInsertCalls.length, 0);
  assert.equal(mock.recurrenceInsertCalls.length, 0);
});

test("createTaskWithOptionalWorkedTime rejects invalid recurrence timezone before task insert", async () => {
  const mock = createTaskCreateSupabaseMock();

  const result = await createTaskWithOptionalWorkedTime(
    {
      task: {
        title: "Invalid timezone",
        project_id: "project-1",
        goal_id: null,
        status: "todo",
        priority: "medium",
      },
      workedTime: null,
      recurrenceRule: "daily",
      recurrenceAnchorDate: "2026-05-04",
      recurrenceTimezone: "UTC+25",
    },
    { supabase: mock.supabase },
  );

  assert.equal(result.errorMessage, "Recurring timezone is invalid.");
  assert.equal(mock.taskInsertCalls.length, 0);
  assert.equal(mock.recurrenceInsertCalls.length, 0);
});

test("createTaskWithOptionalWorkedTime skips recurrence insert for non-recurring tasks", async () => {
  const mock = createTaskCreateSupabaseMock();

  const result = await createTaskWithOptionalWorkedTime(
    {
      task: {
        title: "One-off",
        project_id: "project-1",
        goal_id: null,
        status: "todo",
        priority: "medium",
      },
      workedTime: null,
      recurrenceRule: "",
    },
    { supabase: mock.supabase },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(mock.recurrenceInsertCalls.length, 0);
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

function createTaskReminderSupabaseMock(options?: {
  tasks?: Array<{ id: string; owner_user_id?: string | null }>;
  reminders?: Array<{
    id: string;
    task_id: string;
    remind_at: string;
    channel: string;
    status: string;
    sent_at: string | null;
    failure_reason: string | null;
    created_at: string;
    updated_at: string;
  }>;
  failTaskLookup?: boolean;
  failReminderInsert?: boolean;
  failReminderUpdate?: boolean;
  authUserId?: string | null;
}) {
  const tasks = options?.tasks ?? [{ id: "task-1", owner_user_id: "user-1" }];
  const reminders = [
    ...(options?.reminders ?? [
      {
        id: "reminder-1",
        task_id: "task-1",
        remind_at: "2026-05-02T14:00:00.000Z",
        channel: "email",
        status: "pending",
        sent_at: null,
        failure_reason: null,
        created_at: "2026-05-01T10:00:00.000Z",
        updated_at: "2026-05-01T10:00:00.000Z",
      },
    ]),
  ];
  const reminderInsertCalls: Array<Record<string, unknown>> = [];
  const reminderUpdateCalls: Array<Record<string, unknown>> = [];
  let deleteCallCount = 0;

  const supabase = {
    auth: {
      getUser: async () => ({
        data: { user: options?.authUserId === undefined ? null : { id: options.authUserId } },
        error: null,
      }),
    },
    from(table: string) {
      if (table === "tasks") {
        return {
          select: (columns: string) => {
            assert.ok(columns === "id" || columns === "id, owner_user_id");
            const state = { taskId: "", ownerUserId: null as string | null };

            return {
              eq(column: string, value: string) {
                if (column === "id") {
                  state.taskId = value;
                } else if (column === "owner_user_id") {
                  state.ownerUserId = value;
                } else {
                  throw new Error(`Unexpected task filter: ${column}`);
                }
                return this;
              },
              maybeSingle: async () => {
                if (options?.failTaskLookup) {
                  return { data: null, error: { message: "task lookup failed" } };
                }

                return {
                  data:
                    tasks.find(
                      (task) =>
                        task.id === state.taskId &&
                        (!state.ownerUserId || task.owner_user_id === state.ownerUserId),
                    ) ?? null,
                  error: null,
                };
              },
            };
          },
        };
      }

      if (table === "task_reminders") {
        return {
          insert(row: Record<string, unknown>) {
            reminderInsertCalls.push(row);
            return {
              select: () => ({
                maybeSingle: async () => {
                  if (options?.failReminderInsert) {
                    return { data: null, error: { message: "insert failed" } };
                  }

                  const inserted = {
                    id: "created-reminder",
                    task_id: String(row.task_id),
                    remind_at: String(row.remind_at),
                    channel: String(row.channel),
                    status: String(row.status),
                    sent_at: null,
                    failure_reason: null,
                    created_at: "2026-05-01T10:00:00.000Z",
                    updated_at: "2026-05-01T10:00:00.000Z",
                  };
                  reminders.push(inserted);
                  return { data: inserted, error: null };
                },
              }),
            };
          },
          update(payload: Record<string, unknown>) {
            reminderUpdateCalls.push(payload);
            const state = {
              reminderId: "",
              taskId: "",
              status: "",
            };

            return {
              eq(column: string, value: string) {
                if (column === "id") {
                  state.reminderId = value;
                } else if (column === "task_id") {
                  state.taskId = value;
                } else if (column === "status") {
                  state.status = value;
                } else {
                  throw new Error(`Unexpected reminder filter: ${column}`);
                }
                return this;
              },
              select: () => ({
                maybeSingle: async () => {
                  if (options?.failReminderUpdate) {
                    return { data: null, error: { message: "update failed" } };
                  }

                  const index = reminders.findIndex(
                    (reminder) =>
                      reminder.id === state.reminderId &&
                      reminder.task_id === state.taskId &&
                      reminder.status === state.status,
                  );

                  if (index < 0) {
                    return { data: null, error: null };
                  }

                  reminders[index] = {
                    ...reminders[index],
                    status: String(payload.status),
                    updated_at: String(payload.updated_at),
                  };

                  return { data: reminders[index], error: null };
                },
              }),
            };
          },
          delete() {
            deleteCallCount += 1;
            return {};
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return {
    supabase: supabase as never,
    reminders,
    reminderInsertCalls,
    reminderUpdateCalls,
    getDeleteCallCount() {
      return deleteCallCount;
    },
  };
}

test("createTaskEmailReminder rejects past reminders before task lookup", async () => {
  const mock = createTaskReminderSupabaseMock();

  const result = await createTaskEmailReminder(
    {
      taskId: "task-1",
      remindAt: "2026-05-01T09:00:00.000Z",
      channel: "email",
    },
    {
      supabase: mock.supabase,
      now: new Date("2026-05-01T10:00:00.000Z"),
    },
  );

  assert.equal(result.errorMessage, "Reminder time must be in the future.");
  assert.equal(mock.reminderInsertCalls.length, 0);
});

test("createTaskEmailReminder rejects unsupported channel and status inputs", async () => {
  const mock = createTaskReminderSupabaseMock();

  const unsupportedChannel = await createTaskEmailReminder(
    {
      taskId: "task-1",
      remindAt: "2026-05-01T11:00:00.000Z",
      channel: "sms",
    },
    {
      supabase: mock.supabase,
      now: new Date("2026-05-01T10:00:00.000Z"),
    },
  );
  const unsupportedStatus = await createTaskEmailReminder(
    {
      taskId: "task-1",
      remindAt: "2026-05-01T11:00:00.000Z",
      channel: "email",
      status: "sent",
    },
    {
      supabase: mock.supabase,
      now: new Date("2026-05-01T10:00:00.000Z"),
    },
  );

  assert.equal(unsupportedChannel.errorMessage, "Reminder channel is not supported.");
  assert.equal(unsupportedStatus.errorMessage, "Reminder status is not supported.");
  assert.equal(mock.reminderInsertCalls.length, 0);
});

test("createTaskEmailReminder creates a pending email reminder for a visible task", async () => {
  const mock = createTaskReminderSupabaseMock();

  const result = await createTaskEmailReminder(
    {
      taskId: " task-1 ",
      remindAt: "2026-05-01T11:00:00.000Z",
      channel: "email",
    },
    {
      supabase: mock.supabase,
      now: new Date("2026-05-01T10:00:00.000Z"),
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.status, "pending");
  assert.deepEqual(mock.reminderInsertCalls, [
    {
      task_id: "task-1",
      remind_at: "2026-05-01T11:00:00.000Z",
      channel: "email",
      status: "pending",
    },
  ]);
});

test("createTaskEmailReminder rejects unavailable task access before insert", async () => {
  const mock = createTaskReminderSupabaseMock({ tasks: [] });

  const result = await createTaskEmailReminder(
    {
      taskId: "task-missing",
      remindAt: "2026-05-01T11:00:00.000Z",
      channel: "email",
    },
    {
      supabase: mock.supabase,
      now: new Date("2026-05-01T10:00:00.000Z"),
    },
  );

  assert.equal(result.errorMessage, "Task was not found or is no longer available.");
  assert.equal(mock.reminderInsertCalls.length, 0);
});

test("createTaskEmailReminder rejects task owned by another user before insert", async () => {
  const mock = createTaskReminderSupabaseMock({
    authUserId: "user-1",
    tasks: [{ id: "task-1", owner_user_id: "user-2" }],
  });

  const result = await createTaskEmailReminder(
    {
      taskId: "task-1",
      remindAt: "2026-05-01T11:00:00.000Z",
      channel: "email",
    },
    {
      supabase: mock.supabase,
      now: new Date("2026-05-01T10:00:00.000Z"),
    },
  );

  assert.equal(result.errorMessage, "Task was not found or is no longer available.");
  assert.equal(mock.reminderInsertCalls.length, 0);
});

test("cancelTaskReminder cancels a pending reminder without deleting history", async () => {
  const mock = createTaskReminderSupabaseMock();

  const result = await cancelTaskReminder(
    {
      taskId: "task-1",
      reminderId: "reminder-1",
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-05-01T12:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.status, "cancelled");
  assert.equal(mock.reminders[0]?.status, "cancelled");
  assert.deepEqual(mock.reminderUpdateCalls, [
    {
      status: "cancelled",
      updated_at: "2026-05-01T12:00:00.000Z",
    },
  ]);
  assert.equal(mock.getDeleteCallCount(), 0);
});

test("cancelTaskReminder rejects non-pending or unavailable reminders", async () => {
  const mock = createTaskReminderSupabaseMock({
    reminders: [
      {
        id: "reminder-1",
        task_id: "task-1",
        remind_at: "2026-05-02T14:00:00.000Z",
        channel: "email",
        status: "cancelled",
        sent_at: null,
        failure_reason: null,
        created_at: "2026-05-01T10:00:00.000Z",
        updated_at: "2026-05-01T10:00:00.000Z",
      },
    ],
  });

  const result = await cancelTaskReminder(
    {
      taskId: "task-1",
      reminderId: "reminder-1",
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-05-01T12:00:00.000Z",
    },
  );

  assert.equal(
    result.errorMessage,
    "Pending reminder was not found or is no longer cancellable.",
  );
  assert.equal(mock.getDeleteCallCount(), 0);
});

test("cancelTaskReminder rejects unavailable task access before update", async () => {
  const mock = createTaskReminderSupabaseMock({ tasks: [] });

  const result = await cancelTaskReminder(
    {
      taskId: "task-missing",
      reminderId: "reminder-1",
    },
    {
      supabase: mock.supabase,
      updatedAtIso: "2026-05-01T12:00:00.000Z",
    },
  );

  assert.equal(result.errorMessage, "Task was not found or is no longer available.");
  assert.equal(mock.reminderUpdateCalls.length, 0);
  assert.equal(mock.getDeleteCallCount(), 0);
});

function createWorkspaceSupabaseMock(options?: {
  recurrenceError?: { code?: string; message: string };
  recurrences?: MockRecurrence[];
}) {
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
  const taskReminders = [
    {
      id: "reminder-pending",
      task_id: "quick-win-task",
      remind_at: "2026-05-02T14:00:00.000Z",
      channel: "email",
      status: "pending",
      sent_at: null,
      failure_reason: null,
      created_at: "2026-05-01T10:00:00.000Z",
      updated_at: "2026-05-01T10:00:00.000Z",
    },
    {
      id: "reminder-cancelled",
      task_id: "quick-win-task",
      remind_at: "2026-05-01T14:00:00.000Z",
      channel: "email",
      status: "cancelled",
      sent_at: null,
      failure_reason: null,
      created_at: "2026-05-01T08:00:00.000Z",
      updated_at: "2026-05-01T09:00:00.000Z",
    },
  ];
  const taskRecurrences = options?.recurrences ?? [
    {
      id: "recurrence-daily",
      task_id: "quick-win-task",
      rule: "daily",
      anchor_date: "2026-05-01",
      timezone: "Africa/Casablanca",
      next_occurrence_date: "2026-05-02",
      last_generated_at: null,
      created_at: "2026-05-01T08:00:00.000Z",
      updated_at: "2026-05-01T08:00:00.000Z",
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

      if (table === "task_reminders") {
        return {
          select: () => ({
            in: (_column: string, values: string[]) => ({
              order: async () => ({
                data: taskReminders.filter((reminder) => values.includes(reminder.task_id)),
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "task_recurrences") {
        return {
          select: () => ({
            in: async (_column: string, values: string[]) => ({
              data: options?.recurrenceError
                ? null
                : taskRecurrences.filter((recurrence) => values.includes(recurrence.task_id)),
              error: options?.recurrenceError ?? null,
            }),
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

test("workspace data loads reminders for visible tasks", async () => {
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

  const quickWinTask = result.tasks.find((task) => task.id === "quick-win-task");

  assert.deepEqual(
    quickWinTask?.task_reminders.map((reminder) => ({
      id: reminder.id,
      status: reminder.status,
      channel: reminder.channel,
    })),
    [
      { id: "reminder-pending", status: "pending", channel: "email" },
      { id: "reminder-cancelled", status: "cancelled", channel: "email" },
    ],
  );
});

test("workspace data loads recurrence metadata when recurrence table exists", async () => {
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

  const quickWinTask = result.tasks.find((task) => task.id === "quick-win-task");

  assert.deepEqual(
    quickWinTask?.task_recurrences.map((recurrence) => ({
      id: recurrence.id,
      rule: recurrence.rule,
      nextOccurrenceDate: recurrence.next_occurrence_date,
    })),
    [
      {
        id: "recurrence-daily",
        rule: "daily",
        nextOccurrenceDate: "2026-05-02",
      },
    ],
  );
});

test("workspace data tolerates missing task recurrence table schema cache", async () => {
  const mock = createWorkspaceSupabaseMock({
    recurrenceError: {
      code: "PGRST205",
      message: "Could not find the table 'public.task_recurrences' in the schema cache",
    },
  });
  const warn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
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

    assert.ok(result.tasks.length > 0);
    assert.equal(result.tasks.every((task) => task.task_recurrences.length === 0), true);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = warn;
  }
});

test("recurrence loading fails loudly for unrelated recurrence query errors", async () => {
  const mock = createWorkspaceSupabaseMock({
    recurrenceError: {
      code: "42501",
      message: "permission denied for table task_recurrences",
    },
  });

  await assert.rejects(
    () => getTaskRecurrencesForTasks(mock.supabase, ["quick-win-task"]),
    /Failed to load task recurrences: permission denied for table task_recurrences/,
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
