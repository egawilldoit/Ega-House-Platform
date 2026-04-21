import assert from "node:assert/strict";
import test from "node:test";

import {
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

function createTaskInlineSupabaseMock(options?: {
  sessions?: MockSession[];
  failSessionLookup?: boolean;
  failSessionUpdateId?: string;
  failTaskUpdate?: boolean;
}) {
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
          update(payload: Record<string, unknown>) {
            return {
              eq(column: string, value: string) {
                assert.equal(column, "id");
                taskUpdateCalls.push({ payload, taskId: value });

                if (options?.failTaskUpdate) {
                  return Promise.resolve({ error: { message: "task update failed" } });
                }

                return Promise.resolve({ error: null });
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
