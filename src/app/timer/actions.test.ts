import assert from "node:assert/strict";
import test from "node:test";

import {
  completeStoppedTaskById,
  handleStoppedTimerOutcomeByTaskId,
} from "./actions";

test("completeStoppedTaskById marks a stopped task done via shared task update service", async () => {
  const calls = {
    getTaskById: [] as string[],
    updateTaskInline: [] as Array<Record<string, unknown>>,
  };

  const result = await completeStoppedTaskById("task-1", {
    getTaskById: async (taskId: string) => {
      calls.getTaskById.push(taskId);
      return {
        errorMessage: null,
        data: {
          id: "task-1",
          priority: "medium",
          due_date: "2026-04-25",
          estimate_minutes: 45,
          blocked_reason: null,
        } as never,
      };
    },
    updateTaskInline: async (input) => {
      calls.updateTaskInline.push(input as unknown as Record<string, unknown>);
      return { errorMessage: null };
    },
  });

  assert.equal(result.errorMessage, null);
  assert.deepEqual(calls.getTaskById, ["task-1"]);
  assert.deepEqual(calls.updateTaskInline, [
    {
      taskId: "task-1",
      status: "done",
      priority: "medium",
      dueDate: "2026-04-25",
      estimateMinutes: 45,
      blockedReason: null,
    },
  ]);
});

test("completeStoppedTaskById does not update task when lookup fails", async () => {
  let updateCalled = false;

  const result = await completeStoppedTaskById("task-1", {
    getTaskById: async () => ({
      errorMessage: "Unable to load task right now.",
      data: null,
    }),
    updateTaskInline: async () => {
      updateCalled = true;
      return { errorMessage: null };
    },
  });

  assert.equal(result.errorMessage, "Unable to load task right now.");
  assert.equal(updateCalled, false);
});

test("completeStoppedTaskById does not update task when task is unavailable", async () => {
  let updateCalled = false;

  const result = await completeStoppedTaskById("task-1", {
    getTaskById: async () => ({
      errorMessage: null,
      data: null,
    }),
    updateTaskInline: async () => {
      updateCalled = true;
      return { errorMessage: null };
    },
  });

  assert.equal(result.errorMessage, "Task was not found or is no longer available.");
  assert.equal(updateCalled, false);
});

test("handleStoppedTimerOutcomeByTaskId marks stopped task blocked with a reason", async () => {
  const calls = {
    updateTaskInline: [] as Array<Record<string, unknown>>,
  };

  const result = await handleStoppedTimerOutcomeByTaskId(
    "task-1",
    "blocked",
    "Waiting on vendor",
    {
      getTaskById: async () => ({
        errorMessage: null,
        data: {
          id: "task-1",
          priority: "high",
          due_date: null,
          estimate_minutes: 30,
          blocked_reason: null,
        } as never,
      }),
      updateTaskInline: async (input) => {
        calls.updateTaskInline.push(input as unknown as Record<string, unknown>);
        return { errorMessage: null };
      },
    },
  );

  assert.equal(result.errorMessage, null);
  assert.deepEqual(calls.updateTaskInline, [
    {
      taskId: "task-1",
      status: "blocked",
      priority: "high",
      dueDate: null,
      estimateMinutes: 30,
      blockedReason: "Waiting on vendor",
    },
  ]);
});

test("handleStoppedTimerOutcomeByTaskId requires blocked reason", async () => {
  let updateCalled = false;

  const result = await handleStoppedTimerOutcomeByTaskId("task-1", "blocked", " ", {
    getTaskById: async () => ({
      errorMessage: null,
      data: {
        id: "task-1",
        priority: "medium",
        due_date: null,
        estimate_minutes: null,
        blocked_reason: null,
      } as never,
    }),
    updateTaskInline: async () => {
      updateCalled = true;
      return { errorMessage: null };
    },
  });

  assert.equal(result.errorMessage, "Blocked reason is required when status is Blocked.");
  assert.equal(updateCalled, false);
});

test("handleStoppedTimerOutcomeByTaskId leaves task unchanged for no_change", async () => {
  let updateCalled = false;

  const result = await handleStoppedTimerOutcomeByTaskId("task-1", "no_change", null, {
    getTaskById: async () => ({
      errorMessage: null,
      data: {
        id: "task-1",
        priority: "medium",
        due_date: null,
        estimate_minutes: null,
        blocked_reason: null,
      } as never,
    }),
    updateTaskInline: async () => {
      updateCalled = true;
      return { errorMessage: null };
    },
  });

  assert.equal(result.errorMessage, null);
  assert.equal(updateCalled, false);
});
